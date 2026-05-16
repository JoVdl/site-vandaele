/* ============================================================
   CURAGE VANDAELE – ESTIMATION TOOL
   ============================================================ */

// ── TARIFS DE BASE (fourchettes min/max en €) ──────────────────
// Unités : curage = €/m³, faucardage = €/ml ou €/m², berges = €/ml
const TARIFS = {
  curage: {
    // prix par m³ de vase extraite selon difficulté d'accès
    facile:    { min: 8,  max: 16 },
    moyen:     { min: 12, max: 22 },
    difficile: { min: 18, max: 32 },
    // surcoût évacuation vase (€/m³)
    evacuation: { min: 4, max: 8 },
  },
  faucardage: {
    // prix par ml de berge traitée
    facile:    { min: 6,  max: 12 },
    moyen:     { min: 9,  max: 16 },
    difficile: { min: 14, max: 24 },
    // majorations espèces invasives
    jussie: 1.4, // ×1.4
  },
  berges: {
    enrochement: { min: 120, max: 280 }, // €/ml
    palplanche:  { min: 180, max: 380 },
    gabion:      { min: 100, max: 200 },
    vegetal:     { min: 40,  max: 90  },
    conseil:     { min: 120, max: 280 },
  },
  dragage: {
    // €/m³
    facile:    { min: 18, max: 35 },
    moyen:     { min: 25, max: 50 },
    difficile: { min: 35, max: 70 },
  },
  batillage: {
    // €/ml
    facile:    { min: 80,  max: 160 },
    moyen:     { min: 110, max: 200 },
    difficile: { min: 140, max: 260 },
  },
  diagnostic: {
    // forfait
    min: 0, max: 0, label: 'Gratuit (inclus dans le devis)',
  },
  // mobilisation engin (fixe, ajouté une fois)
  mobilisation: { min: 800, max: 2000 },
};

// ── ÉTAT ──────────────────────────────────────────────────────
let currentPanel = 1;
const state = {
  surface: 0,       // ha
  perimetre: 0,     // ml
  acces: 'moyen',
  travaux: new Set(),
  profVase: 40,     // cm
  pctCurage: 100,   // %
  destinationVase: 'sur-place',
  pctFauc: 30,      // %
  faucJussie: false,
  lgBerges: 100,    // ml
  typeBerge: 'conseil',
  volDragage: 2000, // m³
  lgBatillage: 50,  // ml
};

// ── STEPPER NAVIGATION ────────────────────────────────────────
function goToPanel(n) {
  const panels = document.querySelectorAll('.est-panel');
  panels.forEach(p => p.classList.remove('active'));
  const target = document.getElementById('panel-' + n);
  if (target) target.classList.add('active');

  // Update stepper UI
  document.querySelectorAll('.step-item').forEach(item => {
    const s = parseInt(item.dataset.step);
    item.classList.remove('active', 'done');
    if (s === n) item.classList.add('active');
    else if (s < n) item.classList.add('done');
  });

  currentPanel = n;

  // Sync detail sections when entering panel 3
  if (n === 3) syncDetailSections();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  computeEstimation();
}

// ── SYNC DETAIL SECTIONS ──────────────────────────────────────
function syncDetailSections() {
  ['curage', 'faucardage', 'berges', 'dragage', 'batillage', 'diagnostic'].forEach(t => {
    const sec = document.getElementById('detail-' + t);
    if (sec) sec.classList.toggle('visible', state.travaux.has(t));
  });
}

// ── TRAVAUX CHECKBOXES ────────────────────────────────────────
document.querySelectorAll('input[name="travaux"]').forEach(cb => {
  cb.addEventListener('change', () => {
    if (cb.checked) state.travaux.add(cb.value);
    else state.travaux.delete(cb.value);
    computeEstimation();
  });
});

// ── RANGE SLIDERS ─────────────────────────────────────────────
function bindRange(id, stateKey, displayId, fmt) {
  const el = document.getElementById(id);
  const disp = document.getElementById(displayId);
  if (!el || !disp) return;
  el.addEventListener('input', () => {
    state[stateKey] = parseFloat(el.value);
    disp.textContent = fmt(el.value);
    computeEstimation();
  });
}

bindRange('prof-vase', 'profVase', 'prof-vase-val', v => v + ' cm');
bindRange('pct-curage', 'pctCurage', 'pct-curage-val', v => v + ' %');
bindRange('pct-fauc', 'pctFauc', 'pct-fauc-val', v => v + ' %');
bindRange('lg-berges', 'lgBerges', 'lg-berges-val', v => parseInt(v).toLocaleString('fr') + ' ml');
bindRange('vol-dragage', 'volDragage', 'vol-dragage-val', v => parseInt(v).toLocaleString('fr') + ' m³');
bindRange('lg-batillage', 'lgBatillage', 'lg-batillage-val', v => v + ' ml');

// ── INPUTS ────────────────────────────────────────────────────
function bindInput(id, stateKey, parse) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    state[stateKey] = parse(el.value);
    computeEstimation();
  });
}
bindInput('surface', 'surface', v => parseFloat(v) || 0);
bindInput('perimetre', 'perimetre', v => parseFloat(v) || 0);

const accesEl = document.getElementById('acces');
if (accesEl) accesEl.addEventListener('change', () => { state.acces = accesEl.value || 'moyen'; computeEstimation(); });

const destVaseEl = document.getElementById('destination-vase');
if (destVaseEl) destVaseEl.addEventListener('change', () => { state.destinationVase = destVaseEl.value; computeEstimation(); });

const jussieEl = document.getElementById('fauc-jussie');
if (jussieEl) jussieEl.addEventListener('change', () => { state.faucJussie = jussieEl.checked; computeEstimation(); });

document.querySelectorAll('input[name="type-berge"]').forEach(r => {
  r.addEventListener('change', () => { state.typeBerge = r.value; computeEstimation(); });
});

// ── CALCUL ESTIMATION ─────────────────────────────────────────
function computeEstimation() {
  const acces = state.acces || 'moyen';
  const lines = [];
  let totalMin = 0, totalMax = 0;
  let hasTravaux = false;

  // Mobilisation (ajoutée si au moins un vrai chantier)
  const realTravaux = ['curage', 'faucardage', 'berges', 'dragage', 'batillage'];
  const hasReal = realTravaux.some(t => state.travaux.has(t));

  if (hasReal) {
    totalMin += TARIFS.mobilisation.min;
    totalMax += TARIFS.mobilisation.max;
    lines.push({ label: 'Mobilisation engin', val: fmt(TARIFS.mobilisation.min, TARIFS.mobilisation.max) });
  }

  // CURAGE
  if (state.travaux.has('curage')) {
    hasTravaux = true;
    const surf = state.surface > 0 ? state.surface : 0.5; // ha
    const surfM2 = surf * 10000 * (state.pctCurage / 100);
    const profM = state.profVase / 100;
    const volM3 = surfM2 * profM;
    const t = TARIFS.curage[acces];
    let cMin = volM3 * t.min;
    let cMax = volM3 * t.max;
    if (state.destinationVase === 'evacuation') {
      cMin += volM3 * TARIFS.curage.evacuation.min;
      cMax += volM3 * TARIFS.curage.evacuation.max;
    }
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Curage (~${Math.round(volM3).toLocaleString('fr')} m³)`, val: fmt(cMin, cMax) });
  }

  // FAUCARDAGE
  if (state.travaux.has('faucardage')) {
    hasTravaux = true;
    const perim = state.perimetre > 0 ? state.perimetre : 200;
    const lgFauc = perim * (state.pctFauc / 100);
    const t = TARIFS.faucardage[acces];
    let cMin = lgFauc * t.min;
    let cMax = lgFauc * t.max;
    if (state.faucJussie) { cMin *= TARIFS.faucardage.jussie; cMax *= TARIFS.faucardage.jussie; }
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Faucardage (~${Math.round(lgFauc)} ml)`, val: fmt(cMin, cMax) });
  }

  // BERGES
  if (state.travaux.has('berges')) {
    hasTravaux = true;
    const lg = state.lgBerges;
    const t = TARIFS.berges[state.typeBerge] || TARIFS.berges.conseil;
    const cMin = lg * t.min;
    const cMax = lg * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Défenses berges (${lg} ml)`, val: fmt(cMin, cMax) });
  }

  // DRAGAGE
  if (state.travaux.has('dragage')) {
    hasTravaux = true;
    const vol = state.volDragage;
    const t = TARIFS.dragage[acces];
    const cMin = vol * t.min;
    const cMax = vol * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Dragage (~${vol.toLocaleString('fr')} m³)`, val: fmt(cMin, cMax) });
  }

  // BATILLAGE
  if (state.travaux.has('batillage')) {
    hasTravaux = true;
    const lg = state.lgBatillage;
    const t = TARIFS.batillage[acces];
    const cMin = lg * t.min;
    const cMax = lg * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Protection batillage (${lg} ml)`, val: fmt(cMin, cMax) });
  }

  // DIAGNOSTIC
  if (state.travaux.has('diagnostic')) {
    hasTravaux = true;
    lines.push({ label: 'Diagnostic & visite', val: 'Gratuit' });
  }

  // Render
  const linesEl = document.getElementById('result-lines');
  const totalEl = document.getElementById('result-total-amount');
  if (!linesEl || !totalEl) return;

  if (!hasTravaux && !hasReal) {
    linesEl.innerHTML = '<p class="result-empty">Sélectionnez vos travaux pour voir l\'estimation.</p>';
    totalEl.textContent = '– €';
    return;
  }

  linesEl.innerHTML = lines.map(l =>
    `<div class="result-line">
      <span class="result-line-label">${l.label}</span>
      <span class="result-line-val">${l.val}</span>
    </div>`
  ).join('');

  totalEl.textContent = fmt(totalMin, totalMax);
}

function fmt(min, max) {
  if (min === 0 && max === 0) return 'Gratuit';
  const f = v => Math.round(v).toLocaleString('fr') + ' €';
  return f(min) + ' – ' + f(max);
}

// ── AUTOCOMPLETE ADRESSE (API Base Adresse Nationale) ─────────
const adresseInput = document.getElementById('adresse');
const adresseDropdown = document.getElementById('adresse-dropdown');
let selectedCoords = null; // [lng, lat] de l'adresse choisie
let acDebounce = null;
let acFocusIndex = -1;
let acResults = [];


function renderDropdown(features) {
  acResults = features;
  acFocusIndex = -1;
  if (!features.length) {
    adresseDropdown.classList.remove('open');
    adresseDropdown.innerHTML = '';
    return;
  }
  adresseDropdown.innerHTML = features.map((f, i) => {
    const p = f.properties;
    const type = p.type === 'municipality' ? '🏘️' : p.type === 'street' ? '🛣️' : '📍';
    return `<li role="option" data-idx="${i}">
      <span class="ac-icon">${type}</span>
      <span>
        <span class="ac-main">${p.name || p.label}</span><br/>
        <span class="ac-sub">${p.postcode || ''} ${p.city || ''}</span>
      </span>
    </li>`;
  }).join('');
  adresseDropdown.classList.add('open');

  adresseDropdown.querySelectorAll('li').forEach(li => {
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      selectResult(parseInt(li.dataset.idx));
    });
  });
}

function selectResult(idx) {
  const f = acResults[idx];
  if (!f) return;
  const label = f.properties.label;
  adresseInput.value = label;
  selectedCoords = f.geometry.coordinates; // [lng, lat]
  adresseDropdown.classList.remove('open');
  adresseDropdown.innerHTML = '';
  acResults = [];
  // Centrer la carte Leaflet sur l'adresse choisie
  if (typeof window.centerMapOn === 'function') {
    window.centerMapOn(selectedCoords[0], selectedCoords[1]);
  }
}

function updateFocus() {
  const items = adresseDropdown.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('focused', i === acFocusIndex));
  if (acFocusIndex >= 0 && items[acFocusIndex]) {
    items[acFocusIndex].scrollIntoView({ block: 'nearest' });
  }
}

if (adresseInput) {
  adresseInput.addEventListener('input', () => {
    const q = adresseInput.value.trim();
    clearTimeout(acDebounce);
    if (q.length < 3) {
      adresseDropdown.classList.remove('open');
      adresseDropdown.innerHTML = '';
      return;
    }
    adresseDropdown.innerHTML = '<li class="autocomplete-loading">Recherche en cours…</li>';
    adresseDropdown.classList.add('open');
    acDebounce = setTimeout(async () => {
      try {
        const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`;
        const res = await fetch(url);
        const data = await res.json();
        renderDropdown(data.features || []);
      } catch {
        adresseDropdown.classList.remove('open');
        adresseDropdown.innerHTML = '';
      }
    }, 280);
  });

  adresseInput.addEventListener('keydown', e => {
    const items = adresseDropdown.querySelectorAll('li');
    if (!adresseDropdown.classList.contains('open') || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acFocusIndex = Math.min(acFocusIndex + 1, items.length - 1);
      updateFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acFocusIndex = Math.max(acFocusIndex - 1, 0);
      updateFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (acFocusIndex >= 0) selectResult(acFocusIndex);
      else if (acResults.length) selectResult(0);
    } else if (e.key === 'Escape') {
      adresseDropdown.classList.remove('open');
      adresseDropdown.innerHTML = '';
    }
  });

  document.addEventListener('click', e => {
    if (!adresseInput.contains(e.target) && !adresseDropdown.contains(e.target)) {
      adresseDropdown.classList.remove('open');
    }
  });
}

// ── CARTE LEAFLET ─────────────────────────────────────────────
const mapEl = document.getElementById('leaflet-map');
if (mapEl && typeof L !== 'undefined') {

  const map = L.map('leaflet-map', { zoomControl: true }).setView([46.8, 2.3], 6);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri', maxZoom: 19 }
  ).addTo(map);

  const ignOrtho = L.tileLayer(
    'https://wxs.ign.fr/essentiels/geoportail/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&FORMAT=image%2Fjpeg&STYLE=normal',
    { attribution: '© IGN Géoportail', maxZoom: 21 }
  );

  const planOSM = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  );

  L.control.layers(
    { 'Satellite (Esri)': satellite, 'Orthophoto IGN': ignOrtho, 'Plan OSM': planOSM },
    null, { position: 'topright' }
  ).addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);

  const drawPolygon = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.15, weight: 2 },
    metric: true, feet: false,
  });

  const drawPolyline = new L.Draw.Polyline(map, {
    shapeOptions: { color: '#16a34a', weight: 3 },
    metric: true, feet: false,
  });

  const btnSurface = document.getElementById('btn-draw-surface');
  const btnBerges  = document.getElementById('btn-draw-berges');
  const btnReset   = document.getElementById('btn-draw-reset');
  const infoBar    = document.getElementById('map-info-bar');

  function setMode(mode) {
    drawPolygon.disable();
    drawPolyline.disable();
    btnSurface && btnSurface.classList.remove('active-surface');
    btnBerges  && btnBerges.classList.remove('active-berges');

    if (mode === 'surface') {
      drawPolygon.enable();
      btnSurface && btnSurface.classList.add('active-surface');
      if (infoBar) infoBar.innerHTML = '📐 Cliquez pour placer des points autour de l\'étang. Double-cliquez pour fermer le polygone.';
    } else if (mode === 'berges') {
      drawPolyline.enable();
      btnBerges && btnBerges.classList.add('active-berges');
      if (infoBar) infoBar.innerHTML = '📏 Cliquez pour tracer le long des berges à traiter. Double-cliquez pour terminer.';
    }
  }

  if (btnSurface) btnSurface.addEventListener('click', () => setMode('surface'));
  if (btnBerges)  btnBerges.addEventListener('click',  () => setMode('berges'));
  if (btnReset)   btnReset.addEventListener('click', () => {
    drawnItems.clearLayers();
    drawPolygon.disable(); drawPolyline.disable();
    btnSurface && btnSurface.classList.remove('active-surface');
    btnBerges  && btnBerges.classList.remove('active-berges');
    if (infoBar) infoBar.innerHTML = 'ℹ️ Dessin effacé. Choisissez un mode pour recommencer.';
  });

  map.on(L.Draw.Event.CREATED, e => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);

    if (e.layerType === 'polygon') {
      const lls = e.layer.getLatLngs()[0];
      const areaM2 = L.GeometryUtil.geodesicArea(lls);
      const areaHa = (areaM2 / 10000).toFixed(4);
      let perim = 0;
      for (let i = 0; i < lls.length; i++) perim += lls[i].distanceTo(lls[(i + 1) % lls.length]);
      perim = Math.round(perim);

      const surfEl  = document.getElementById('surface');
      const perimEl = document.getElementById('perimetre');
      if (surfEl)  { surfEl.value  = areaHa; state.surface   = parseFloat(areaHa); }
      if (perimEl) { perimEl.value = perim;  state.perimetre = perim; }
      computeEstimation();

      if (infoBar) infoBar.innerHTML =
        `✅ Surface : <strong>${parseFloat(areaHa).toLocaleString('fr')} ha</strong> &nbsp;·&nbsp; Périmètre : <strong>${perim.toLocaleString('fr')} m</strong>`;
      setTimeout(() => setMode('surface'), 300);
    }

    if (e.layerType === 'polyline') {
      const lls = e.layer.getLatLngs();
      let dist = 0;
      for (let i = 0; i < lls.length - 1; i++) dist += lls[i].distanceTo(lls[i + 1]);
      dist = Math.round(dist);
      const perimEl = document.getElementById('perimetre');
      if (perimEl) { perimEl.value = dist; state.perimetre = dist; }
      computeEstimation();
      if (infoBar) infoBar.innerHTML = `✅ Longueur tracée : <strong>${dist.toLocaleString('fr')} m</strong>`;
      setTimeout(() => setMode('berges'), 300);
    }
  });

  // Exposé pour l'autocomplete : centrer la carte sur l'adresse choisie
  window.centerMapOn = (lng, lat) => map.setView([lat, lng], 17);

  // Mode par défaut
  setMode('surface');
}

// ── SOUMISSION ────────────────────────────────────────────────
function submitEstimation() {
  const prenom = document.getElementById('c-prenom')?.value?.trim();
  const nom    = document.getElementById('c-nom')?.value?.trim();
  const email  = document.getElementById('c-email')?.value?.trim();
  const tel    = document.getElementById('c-tel')?.value?.trim();
  const rgpd   = document.getElementById('c-rgpd')?.checked;

  if (!prenom || !nom || !email || !tel) {
    showToast('Merci de remplir tous les champs obligatoires.', 'error');
    return;
  }
  if (!rgpd) {
    showToast('Veuillez accepter la politique de confidentialité.', 'error');
    return;
  }

  // Masquer le formulaire et afficher la confirmation
  document.querySelectorAll('.est-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('confirm-panel').classList.add('active');
  document.querySelector('.result-card').style.display = 'none';
  document.getElementById('stepper').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── TOAST (réutilise celle de main.js ou fallback) ────────────
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast--' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4500);
}

// Init
computeEstimation();
