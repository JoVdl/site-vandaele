/* ============================================================
   CURAGE VANDAELE – ESTIMATION TOOL
   ============================================================ */

// ── TARIFS (fourchettes min/max en €) ─────────────────────────
const TARIFS = {
  mobilisation: { min: 800, max: 2000 },

  hydrocurage: {
    // €/ml selon accès
    facile:    { min: 18, max: 30 },
    moyen:     { min: 28, max: 48 },
    difficile: { min: 40, max: 70 },
  },

  curage: {
    // €/m³ de vase extraite selon accès
    facile:    { min: 12, max: 22 },
    moyen:     { min: 18, max: 32 },
    difficile: { min: 28, max: 50 },
    evacuation: { min: 5, max: 10 },
  },

  faucardage: {
    // €/ha de surface traitée selon accès
    facile:    { min: 700,  max: 1200 },
    moyen:     { min: 900,  max: 1600 },
    difficile: { min: 1300, max: 2200 },
    jussie: 1.4,
  },

  berges: {
    // €/ml selon type de protection
    enrochement: { min: 150, max: 280 },
    palplanche:  { min: 200, max: 400 },
    gabion:      { min: 120, max: 220 },
    vegetal:     { min: 50,  max: 100 },
    conseil:     { min: 150, max: 280 },
  },

  'broyage-forestier': {
    // €/ha selon densité de végétation
    legere:  { min: 900,  max: 1600 },
    moyenne: { min: 1500, max: 2800 },
    dense:   { min: 2500, max: 4500 },
  },

  'broyage-roseaux': {
    sans: {
      facile:    { min: 500, max: 800  },
      moyen:     { min: 700, max: 1100 },
      difficile: { min: 900, max: 1500 },
    },
    avec: {
      facile:    { min: 1000, max: 1600 },
      moyen:     { min: 1200, max: 2000 },
      difficile: { min: 1600, max: 2800 },
    },
  },

  diagnostic: { min: 0, max: 0 },
};

// ── ÉTAT ──────────────────────────────────────────────────────
let currentPanel = 1;
const state = {
  surface: 0,
  perimetre: 0,
  acces: 'moyen',
  travaux: new Set(),
  // Hydrocurage
  lgHydrocurage: 100,
  // Curage mécanique
  profVase: 40,
  pctCurage: 100,
  destinationVase: 'sur-place',
  // Faucardage
  pctFauc: 30,
  faucJussie: false,
  // Berges
  lgBerges: 100,
  typeBerge: 'conseil',
  // Broyage forestier
  surfBroyageForestier: 1.0,
  densiteBroyage: 'moyenne',
  // Broyage roseaux
  surfBroyageRoseaux: 1.0,
  avecRamassage: false,
};

// ── STEPPER NAVIGATION ────────────────────────────────────────
function goToPanel(n) {
  const panels = document.querySelectorAll('.est-panel');
  panels.forEach(p => p.classList.remove('active'));
  const target = document.getElementById('panel-' + n);
  if (target) target.classList.add('active');

  document.querySelectorAll('.step-item').forEach(item => {
    const s = parseInt(item.dataset.step);
    item.classList.remove('active', 'done');
    if (s === n) item.classList.add('active');
    else if (s < n) item.classList.add('done');
  });

  currentPanel = n;
  if (n === 3) syncDetailSections();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  computeEstimation();
}

// ── SYNC DETAIL SECTIONS ──────────────────────────────────────
function syncDetailSections() {
  ['hydrocurage', 'curage', 'faucardage', 'berges', 'broyage-forestier', 'broyage-roseaux', 'diagnostic'].forEach(t => {
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

bindRange('lg-hydrocurage',         'lgHydrocurage',         'lg-hydrocurage-val',         v => parseInt(v).toLocaleString('fr') + ' ml');
bindRange('prof-vase',              'profVase',               'prof-vase-val',               v => v + ' cm');
bindRange('pct-curage',             'pctCurage',              'pct-curage-val',              v => v + ' %');
bindRange('pct-fauc',               'pctFauc',                'pct-fauc-val',                v => v + ' %');
bindRange('lg-berges',              'lgBerges',               'lg-berges-val',               v => parseInt(v).toLocaleString('fr') + ' ml');
bindRange('surf-broyage-forestier', 'surfBroyageForestier',   'surf-broyage-forestier-val',  v => parseFloat(v).toFixed(1) + ' ha');
bindRange('surf-broyage-roseaux',   'surfBroyageRoseaux',     'surf-broyage-roseaux-val',    v => parseFloat(v).toFixed(1) + ' ha');

// ── INPUTS ────────────────────────────────────────────────────
function bindInput(id, stateKey, parse) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    state[stateKey] = parse(el.value);
    computeEstimation();
  });
}
bindInput('surface',   'surface',   v => parseFloat(v) || 0);
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

document.querySelectorAll('input[name="densite-broyage"]').forEach(r => {
  r.addEventListener('change', () => { state.densiteBroyage = r.value; computeEstimation(); });
});

const ramassageEl = document.getElementById('avec-ramassage');
if (ramassageEl) ramassageEl.addEventListener('change', () => { state.avecRamassage = ramassageEl.checked; computeEstimation(); });

// ── CALCUL ESTIMATION ─────────────────────────────────────────
function computeEstimation() {
  const acces = state.acces || 'moyen';
  const lines = [];
  let totalMin = 0, totalMax = 0;
  let hasTravaux = false;

  const realTravaux = ['hydrocurage', 'curage', 'faucardage', 'berges', 'broyage-forestier', 'broyage-roseaux'];
  const hasReal = realTravaux.some(t => state.travaux.has(t));

  if (hasReal) {
    totalMin += TARIFS.mobilisation.min;
    totalMax += TARIFS.mobilisation.max;
    lines.push({ label: 'Mobilisation engin', val: fmtRange(TARIFS.mobilisation.min, TARIFS.mobilisation.max) });
  }

  // HYDROCURAGE
  if (state.travaux.has('hydrocurage')) {
    hasTravaux = true;
    const lg = state.lgHydrocurage;
    const t = TARIFS.hydrocurage[acces];
    const cMin = lg * t.min;
    const cMax = lg * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Hydrocurage (${lg.toLocaleString('fr')} ml)`, val: fmtRange(cMin, cMax) });
  }

  // CURAGE MÉCANIQUE
  if (state.travaux.has('curage')) {
    hasTravaux = true;
    const surf = state.surface > 0 ? state.surface : 0.5;
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
    lines.push({ label: `Curage mécanique (~${Math.round(volM3).toLocaleString('fr')} m³)`, val: fmtRange(cMin, cMax) });
  }

  // FAUCARDAGE
  if (state.travaux.has('faucardage')) {
    hasTravaux = true;
    const surf = (state.surface > 0 ? state.surface : 0.5) * (state.pctFauc / 100);
    const t = TARIFS.faucardage[acces];
    let cMin = surf * t.min;
    let cMax = surf * t.max;
    if (state.faucJussie) { cMin *= TARIFS.faucardage.jussie; cMax *= TARIFS.faucardage.jussie; }
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Faucardage (~${surf.toFixed(2)} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DÉFENSES DE BERGES
  if (state.travaux.has('berges')) {
    hasTravaux = true;
    const lg = state.lgBerges;
    const t = TARIFS.berges[state.typeBerge] || TARIFS.berges.conseil;
    const cMin = lg * t.min;
    const cMax = lg * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Défenses berges (${lg.toLocaleString('fr')} ml)`, val: fmtRange(cMin, cMax) });
  }

  // BROYAGE FORESTIER
  if (state.travaux.has('broyage-forestier')) {
    hasTravaux = true;
    const surf = state.surfBroyageForestier;
    const t = TARIFS['broyage-forestier'][state.densiteBroyage] || TARIFS['broyage-forestier'].moyenne;
    const cMin = surf * t.min;
    const cMax = surf * t.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Broyage forestier (${surf.toLocaleString('fr')} ha)`, val: fmtRange(cMin, cMax) });
  }

  // BROYAGE DE ROSEAUX
  if (state.travaux.has('broyage-roseaux')) {
    hasTravaux = true;
    const surf = state.surfBroyageRoseaux;
    const key = state.avecRamassage ? 'avec' : 'sans';
    const t = TARIFS['broyage-roseaux'][key][acces];
    const cMin = surf * t.min;
    const cMax = surf * t.max;
    totalMin += cMin; totalMax += cMax;
    const label = state.avecRamassage ? 'Roseaux + ramassage' : 'Broyage roseaux';
    lines.push({ label: `${label} (${surf.toLocaleString('fr')} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DIAGNOSTIC
  if (state.travaux.has('diagnostic')) {
    hasTravaux = true;
    lines.push({ label: 'Diagnostic & visite technique', val: 'Gratuit' });
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

  totalEl.textContent = fmtRange(totalMin, totalMax);
}

function fmtRange(min, max) {
  if (min === 0 && max === 0) return 'Gratuit';
  const f = v => Math.round(v).toLocaleString('fr') + ' €';
  return f(min) + ' – ' + f(max);
}

// ── AUTOCOMPLETE ADRESSE (API Base Adresse Nationale) ─────────
const adresseInput = document.getElementById('adresse');
const adresseDropdown = document.getElementById('adresse-dropdown');
let selectedCoords = null;
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
  selectedCoords = f.geometry.coordinates;
  adresseDropdown.classList.remove('open');
  adresseDropdown.innerHTML = '';
  acResults = [];
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

  const ignOrtho = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&FORMAT=image%2Fjpeg&STYLE=normal',
    { attribution: '© IGN – Géoplateforme', maxZoom: 21, maxNativeZoom: 19 }
  ).addTo(map);

  const ignPlan = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&FORMAT=image%2Fpng&STYLE=normal',
    { attribution: '© IGN – Géoplateforme', maxZoom: 19 }
  );

  const planOSM = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  );

  L.control.layers(
    { '🛰️ Orthophoto IGN': ignOrtho, '🗺️ Plan IGN': ignPlan, '📍 OpenStreetMap': planOSM },
    null, { position: 'topright' }
  ).addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);

  const drawPolygon = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: '#3d9e62', fillColor: '#3d9e62', fillOpacity: 0.15, weight: 2 },
    metric: true, feet: false,
  });

  const drawPolyline = new L.Draw.Polyline(map, {
    shapeOptions: { color: '#56B57A', weight: 3 },
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

  window.centerMapOn = (lng, lat) => {
    map.setView([lat, lng], 17);
    map.invalidateSize();
  };

  setMode('surface');
  setTimeout(() => map.invalidateSize(), 100);
  setTimeout(() => map.invalidateSize(), 400);
}

// ── SOUMISSION ────────────────────────────────────────────────
const WEB3FORMS_KEY = 'd6047275-07ab-4b26-8be7-3b39b661f43b';

async function submitEstimation() {
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

  const btn = document.getElementById('btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }

  const travaux = [...state.travaux].join(', ') || 'Non précisé';
  const estimation = document.getElementById('result-total-amount')?.textContent || 'Non calculée';

  const body = {
    access_key:  WEB3FORMS_KEY,
    subject:     `Demande d'estimation – ${prenom} ${nom}`,
    from_name:   'Site Curage Vandaele',
    redirect:    'false',
    Prénom:      prenom,
    Nom:         nom,
    Email:       email,
    Téléphone:   tel,
    Profil:      document.getElementById('c-profil')?.value || '',
    Délai:       document.getElementById('c-delai')?.value || '',
    'Adresse chantier':       document.getElementById('adresse')?.value || 'Non renseignée',
    'Surface (ha)':           state.surface  || 'Non mesurée',
    'Périmètre (ml)':         state.perimetre || 'Non mesuré',
    'Accès chantier':         state.acces,
    'Type de travaux':        travaux,
    'Estimation indicative':  estimation,
    ...(state.travaux.has('hydrocurage') ? {
      'Hydrocurage – longueur (ml)': state.lgHydrocurage,
    } : {}),
    ...(state.travaux.has('curage') ? {
      'Curage – prof. vase (cm)':   state.profVase,
      'Curage – % surface':         state.pctCurage,
      'Curage – destination vase':  state.destinationVase,
    } : {}),
    ...(state.travaux.has('faucardage') ? {
      'Faucardage – % couverture':  state.pctFauc,
      'Faucardage – jussie':        state.faucJussie ? 'Oui' : 'Non',
    } : {}),
    ...(state.travaux.has('berges') ? {
      'Berges – longueur (ml)':     state.lgBerges,
      'Berges – type':              state.typeBerge,
    } : {}),
    ...(state.travaux.has('broyage-forestier') ? {
      'Broyage forestier – surface (ha)': state.surfBroyageForestier,
      'Broyage forestier – densité':      state.densiteBroyage,
    } : {}),
    ...(state.travaux.has('broyage-roseaux') ? {
      'Broyage roseaux – surface (ha)':    state.surfBroyageRoseaux,
      'Broyage roseaux – avec ramassage':  state.avecRamassage ? 'Oui' : 'Non',
    } : {}),
  };

  try {
    const res  = await fetch('https://api.web3forms.com/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      document.querySelectorAll('.est-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('confirm-panel').classList.add('active');
      document.querySelector('.result-card').style.display = 'none';
      document.getElementById('stepper').style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      showToast('Erreur lors de l\'envoi. Appelez-nous au 06 32 44 11 17.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Envoyer ma demande'; }
    }
  } catch {
    showToast('Erreur réseau. Appelez-nous au 06 32 44 11 17.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Envoyer ma demande'; }
  }
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast--' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4500);
}

computeEstimation();
