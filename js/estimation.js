/* ============================================================
   CURAGE VANDAELE – ESTIMATION TOOL
   ============================================================ */

// Toujours partir du haut de la page à l'arrivée
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
window.addEventListener('load', () => window.scrollTo(0, 0));

// ── FIREBASE ──────────────────────────────────────────────────
// Remplacer par votre config : Firebase Console > Paramètres du projet > Vos applications
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCedrdegva_01oxW1zqhMX-qrRdn_Xczjc',
  authDomain:        'curage-vandaele.firebaseapp.com',
  projectId:         'curage-vandaele',
  storageBucket:     'curage-vandaele.firebasestorage.app',
  messagingSenderId: '391514836726',
  appId:             '1:391514836726:web:357672b95b8af8275426d7',
};
let db = null;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
  }
} catch (e) {
  console.error('[Firebase] Initialisation échouée :', e);
}

// ── TARIFS (fourchettes min/max en €) ─────────────────────────
let TARIFS = {
  hydrocurage: {
    mobilisation: { min: 800,  max: 2000 }, // pompe + groupe
    base:         { min: 15,   max: 30   }, // €/m³
    moyen:        20,                        // +20 %
    difficile:    40,                        // +40 %
    evacuation:   { min: 8,    max: 15   }, // €/m³ supplément évacuation
  },

  curage: {
    mobilisation: { min: 1200, max: 3000 }, // drague / pelle amphibie
    base:         { min: 12,   max: 22   }, // €/m³
    moyen:        20,
    difficile:    40,
    evacuation:   { min: 5, max: 10 },      // €/m³ supplément
  },

  faucardage: {
    mobilisation: { min: 600,  max: 1500 }, // bateau faucardeur
    base:         { min: 700,  max: 1200 }, // €/ha
    moyen:        20,
    difficile:    40,
    jussie:       40,                        // +40 %
  },

  berges: {
    mobilisation: { min: 800,  max: 2000 }, // pelle + matériaux
    enrochement:  { min: 150,  max: 280  },
    palplanche:   { min: 200,  max: 400  },
    gabion:       { min: 120,  max: 220  },
    vegetal:      { min: 50,   max: 100  },
    conseil:      { min: 150,  max: 280  },
  },

  'broyage-forestier': {
    mobilisation: { min: 600,  max: 1500 }, // broyeur forestier
    legere:       { min: 900,  max: 1600 },
    moyenne:      { min: 1500, max: 2800 },
    dense:        { min: 2500, max: 4500 },
  },

  'broyage-roseaux': {
    mobilisation: { min: 500,  max: 1200 }, // bateau + broyeur
    base:         { min: 500,  max: 800  }, // €/ha
    ramassage:    80,                        // +80 % avec ramassage
    moyen:        30,
    difficile:    60,
  },

  diagnostic: { min: 0, max: 0 },
};

// Charge les tarifs depuis Firestore si disponible (admin peut les modifier)
if (typeof db !== 'undefined' && db) {
  db.collection('config').doc('tarifs').get().then(snap => {
    if (snap.exists) {
      const data = snap.data();
      // Ignorer si ancien format (avant base+modifiers)
      if (data.hydrocurage?.base) {
        TARIFS = data;
        if (typeof computeEstimation === 'function') computeEstimation();
      }
    }
  }).catch(e => console.error('[Firebase] Tarifs load failed:', e.code, e.message));
}

// ── ÉTAT ──────────────────────────────────────────────────────
let lastEstMin = 0, lastEstMax = 0;
let currentPanel = 1;
const state = {
  surface: 0,
  perimetre: 0,
  acces: 'moyen',
  travaux: new Set(),
  // Hydrocurage
  epaisseurHydro: 30,
  destinationVaseHydro: 'sur-place',
  natureTerrainHydro: 'pature',
  distanceDepotHydro: 50,
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
  // Profil client
  typeClient: 'particulier',
  // Infos libres
  infosSup: '',
  geojson: null,
  lat: null,
  lng: null,
  demandeAccompagnement: false,
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

bindRange('ep-hydrocurage',         'epaisseurHydro',        'ep-hydrocurage-val',        v => parseInt(v) + ' cm');
bindRange('dist-depot-hydro',       'distanceDepotHydro',    'dist-depot-hydro-val',      v => parseInt(v) + ' m');
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
function updateSurfaceHint(m2) {
  const hint = document.getElementById('surface-hint');
  if (!hint || !m2) return;
  const m2fmt = Math.round(m2).toLocaleString('fr');
  const hafmt = (m2 / 10000).toLocaleString('fr', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (m2 < 10000) {
    hint.textContent = `${m2fmt} m² (${hafmt} ha) · modifiable manuellement`;
  } else {
    hint.textContent = `${hafmt} ha (${m2fmt} m²) · modifiable manuellement`;
  }
}

bindInput('surface',   'surface',   v => (parseFloat(v) || 0) / 10000);
const surfInputEl = document.getElementById('surface');
if (surfInputEl) surfInputEl.addEventListener('input', () => updateSurfaceHint(parseFloat(surfInputEl.value) || 0));
bindInput('perimetre', 'perimetre', v => parseFloat(v) || 0);
bindInput('infos-sup', 'infosSup',  v => v);

document.querySelectorAll('input[name="type-client"]').forEach(r => {
  r.addEventListener('change', () => {
    state.typeClient = r.value;
    const hints = {
      particulier:  'Tarif indicatif TTC · Devis définitif sur visite technique.',
      professionnel: 'Prix hors taxes · TVA 20% applicable sur facture.',
      collectivite:  'Prix hors taxes · Majoration de 10% pour démarches administratives et marchés publics.',
      association:   'Tarif indicatif TTC · Devis définitif sur visite technique.',
    };
    const hintEl = document.getElementById('client-type-hint');
    if (hintEl) hintEl.textContent = hints[r.value] || '';
    computeEstimation();
  });
});

const accesEl = document.getElementById('acces');
if (accesEl) accesEl.addEventListener('change', () => { state.acces = accesEl.value || 'moyen'; computeEstimation(); });

const destVaseEl = document.getElementById('destination-vase');
if (destVaseEl) destVaseEl.addEventListener('change', () => { state.destinationVase = destVaseEl.value; computeEstimation(); });

document.querySelectorAll('input[name="dest-vase-hydro"]').forEach(r => {
  r.addEventListener('change', () => {
    state.destinationVaseHydro = r.value;
    const stockDetails = document.getElementById('hydro-stock-details');
    if (stockDetails) stockDetails.style.display = r.value === 'sur-place' ? '' : 'none';
    computeEstimation();
  });
});

const natureTerrainEl = document.getElementById('nature-terrain-hydro');
if (natureTerrainEl) natureTerrainEl.addEventListener('change', () => { state.natureTerrainHydro = natureTerrainEl.value; });

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
function accMod(t, acces) {
  if (acces === 'difficile') return 1 + (t.difficile || 0) / 100;
  if (acces === 'moyen')     return 1 + (t.moyen     || 0) / 100;
  return 1;
}

function computeEstimation() {
  const acces = state.acces || 'moyen';
  const lines = [];
  let totalMin = 0, totalMax = 0;
  let hasTravaux = false;

  function addMobi(t, label) {
    if (!t?.mobilisation) return;
    totalMin += t.mobilisation.min;
    totalMax += t.mobilisation.max;
    lines.push({ label: `Mobilisation – ${label}`, val: fmtRange(t.mobilisation.min, t.mobilisation.max) });
  }

  // HYDROCURAGE
  if (state.travaux.has('hydrocurage')) {
    hasTravaux = true;
    const t = TARIFS.hydrocurage;
    addMobi(t, 'pompe / hydrocureur');
    const surfM2 = (state.surface > 0 ? state.surface : 0.5) * 10000;
    const vol = Math.max(1, Math.round(surfM2 * (state.epaisseurHydro / 100)));
    const m = accMod(t, acces);
    let cMin = vol * t.base.min * m;
    let cMax = vol * t.base.max * m;
    if (state.destinationVaseHydro === 'evacuation' && t.evacuation) {
      cMin += vol * t.evacuation.min;
      cMax += vol * t.evacuation.max;
    }
    totalMin += cMin; totalMax += cMax;
    const hydLabel = state.destinationVaseHydro === 'evacuation'
      ? `Hydrocurage + évacuation (${vol.toLocaleString('fr')} m³)`
      : `Hydrocurage (${vol.toLocaleString('fr')} m³)`;
    lines.push({ label: hydLabel, val: fmtRange(cMin, cMax) });
  }

  // CURAGE MÉCANIQUE
  if (state.travaux.has('curage')) {
    hasTravaux = true;
    const t = TARIFS.curage;
    addMobi(t, 'drague / pelle amphibie');
    const surf = state.surface > 0 ? state.surface : 0.5;
    const surfM2 = surf * 10000 * (state.pctCurage / 100);
    const profM = state.profVase / 100;
    const volM3 = surfM2 * profM;
    const m = accMod(t, acces);
    let cMin = volM3 * t.base.min * m;
    let cMax = volM3 * t.base.max * m;
    if (state.destinationVase === 'evacuation' || state.destinationVase === 'valorisation') {
      cMin += volM3 * t.evacuation.min;
      cMax += volM3 * t.evacuation.max;
    }
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Curage mécanique (~${Math.round(volM3).toLocaleString('fr')} m³)`, val: fmtRange(cMin, cMax) });
  }

  // FAUCARDAGE
  if (state.travaux.has('faucardage')) {
    hasTravaux = true;
    const t = TARIFS.faucardage;
    addMobi(t, 'bateau faucardeur');
    const surf = (state.surface > 0 ? state.surface : 0.5) * (state.pctFauc / 100);
    const m = accMod(t, acces) * (state.faucJussie ? (1 + (t.jussie || 0) / 100) : 1);
    const cMin = surf * t.base.min * m;
    const cMax = surf * t.base.max * m;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Faucardage (~${surf.toFixed(2)} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DÉFENSES DE BERGES
  if (state.travaux.has('berges')) {
    hasTravaux = true;
    const t = TARIFS.berges;
    addMobi(t, 'pelle + matériaux');
    const tp = t[state.typeBerge] || t.conseil;
    const lg = state.lgBerges;
    const cMin = lg * tp.min;
    const cMax = lg * tp.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Défenses berges (${lg.toLocaleString('fr')} ml)`, val: fmtRange(cMin, cMax) });
  }

  // BROYAGE FORESTIER
  if (state.travaux.has('broyage-forestier')) {
    hasTravaux = true;
    const t = TARIFS['broyage-forestier'];
    addMobi(t, 'broyeur forestier');
    const tp = t[state.densiteBroyage] || t.moyenne;
    const surf = state.surfBroyageForestier;
    const cMin = surf * tp.min;
    const cMax = surf * tp.max;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Broyage forestier (${surf.toLocaleString('fr')} ha)`, val: fmtRange(cMin, cMax) });
  }

  // BROYAGE DE ROSEAUX
  if (state.travaux.has('broyage-roseaux')) {
    hasTravaux = true;
    const t = TARIFS['broyage-roseaux'];
    addMobi(t, 'bateau + broyeur');
    const surf = state.surfBroyageRoseaux;
    const m = accMod(t, acces) * (state.avecRamassage ? (1 + (t.ramassage || 0) / 100) : 1);
    const cMin = surf * t.base.min * m;
    const cMax = surf * t.base.max * m;
    totalMin += cMin; totalMax += cMax;
    const label = state.avecRamassage ? 'Roseaux + ramassage' : 'Broyage roseaux';
    lines.push({ label: `${label} (${surf.toLocaleString('fr')} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DIAGNOSTIC
  if (state.travaux.has('diagnostic')) {
    hasTravaux = true;
    lines.push({ label: 'Diagnostic & visite technique', val: 'Gratuit' });
  }

  // Modificateur type de client
  if (state.typeClient === 'collectivite' && (totalMin > 0 || totalMax > 0)) {
    totalMin = Math.round(totalMin * 1.1);
    totalMax = Math.round(totalMax * 1.1);
    lines.push({ label: '↳ Majoration collectivité (+10%)', val: 'incluse' });
  }
  const isTtcNote = state.typeClient === 'professionnel' || state.typeClient === 'collectivite';

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

  lastEstMin = totalMin;
  lastEstMax = totalMax;
  totalEl.textContent = fmtRange(totalMin, totalMax);

  const tvaNote = document.getElementById('result-tva-note');
  if (tvaNote) tvaNote.style.display = isTtcNote ? '' : 'none';
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
  const btnFinish  = document.getElementById('btn-draw-finish');
  const infoBar    = document.getElementById('map-info-bar');

  function setMode(mode) {
    drawPolygon.disable();
    drawPolyline.disable();
    btnSurface && btnSurface.classList.remove('active-surface');
    btnBerges  && btnBerges.classList.remove('active-berges');
    if (btnFinish) btnFinish.style.display = 'none';

    if (mode === 'surface') {
      drawPolygon.enable();
      btnSurface && btnSurface.classList.add('active-surface');
      if (btnFinish) btnFinish.style.display = '';
      if (infoBar) infoBar.innerHTML = '📐 Cliquez pour placer des points. Cliquez sur le 1<sup>er</sup> point ou appuyez sur <strong>Terminer</strong> pour fermer.';
    } else if (mode === 'berges') {
      drawPolyline.enable();
      btnBerges && btnBerges.classList.add('active-berges');
      if (btnFinish) btnFinish.style.display = '';
      if (infoBar) infoBar.innerHTML = '📏 Cliquez pour tracer le long des berges. Appuyez sur <strong>Terminer</strong> pour valider.';
    }
  }

  // ── FERMETURE MANUELLE (ne dépend pas de _finishShape) ──────────
  let closeZoneMarker = null;
  function removeCloseZone() {
    if (closeZoneMarker) { map.removeLayer(closeZoneMarker); closeZoneMarker = null; }
  }

  function finishCurrentDrawing() {
    if (drawPolygon._enabled) {
      const pts = (drawPolygon._markers || []).map(m => m.getLatLng());
      if (pts.length < 3) {
        if (infoBar) infoBar.innerHTML = '⚠️ Tracez au moins 3 points pour créer une surface.';
        return;
      }
      removeCloseZone();
      drawPolygon.disable();
      const layer = L.polygon(pts, { color: '#3d9e62', fillColor: '#3d9e62', fillOpacity: 0.15, weight: 2 });
      map.fire(L.Draw.Event.CREATED, { layer, layerType: 'polygon' });
      return;
    }
    if (drawPolyline._enabled) {
      const pts = (drawPolyline._markers || []).map(m => m.getLatLng());
      if (pts.length < 2) {
        if (infoBar) infoBar.innerHTML = '⚠️ Tracez au moins 2 points pour mesurer les berges.';
        return;
      }
      drawPolyline.disable();
      const layer = L.polyline(pts, { color: '#56B57A', weight: 3 });
      map.fire(L.Draw.Event.CREATED, { layer, layerType: 'polyline' });
    }
  }

  // Marqueur cliquable élargi sur le 1er point (aide au clic)
  map.on('draw:drawvertex', () => {
    removeCloseZone();
    if (!drawPolygon._enabled || !drawPolygon._markers || drawPolygon._markers.length < 3) return;
    const firstLL = drawPolygon._markers[0].getLatLng();
    closeZoneMarker = L.marker(firstLL, {
      icon: L.divIcon({
        html: '<div style="width:36px;height:36px;border:3px solid #3d9e62;border-radius:50%;background:rgba(61,158,98,.25);box-sizing:border-box;cursor:pointer;" title="Cliquer pour terminer"></div>',
        className: '',
        iconSize:   [36, 36],
        iconAnchor: [18, 18],
      }),
      interactive: true,
      zIndexOffset: 2000,
    }).addTo(map);
    closeZoneMarker.on('click', e => {
      L.DomEvent.stopPropagation(e);
      finishCurrentDrawing();
    });
  });
  map.on('draw:drawstop', removeCloseZone);

  if (btnSurface) btnSurface.addEventListener('click', () => setMode('surface'));
  if (btnBerges)  btnBerges.addEventListener('click',  () => setMode('berges'));
  if (btnReset)   btnReset.addEventListener('click', () => {
    removeCloseZone();
    drawPolygon.disable(); drawPolyline.disable();
    drawnItems.clearLayers();
    btnSurface && btnSurface.classList.remove('active-surface');
    btnBerges  && btnBerges.classList.remove('active-berges');
    if (btnFinish) btnFinish.style.display = 'none';
    const zoneEl = document.getElementById('zone-info');
    if (zoneEl) { zoneEl.innerHTML = ''; zoneEl.style.display = 'none'; }
    state.demandeAccompagnement = false;
    if (infoBar) infoBar.innerHTML = 'ℹ️ Dessin effacé. Choisissez un mode pour recommencer.';
  });

  if (btnFinish) btnFinish.addEventListener('click', finishCurrentDrawing);

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
      if (surfEl)  { const m2 = Math.round(areaM2); surfEl.value = m2; state.surface = m2 / 10000; updateSurfaceHint(m2); }
      if (perimEl) { perimEl.value = perim;  state.perimetre = perim; }
      state.geojson = e.layer.toGeoJSON();
      state.lat = lls.reduce((s, ll) => s + ll.lat, 0) / lls.length;
      state.lng = lls.reduce((s, ll) => s + ll.lng, 0) / lls.length;
      computeEstimation();

      const areaM2display = Math.round(areaM2).toLocaleString('fr');
      const areaHaDisplay = parseFloat(areaHa).toLocaleString('fr', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      if (infoBar) infoBar.innerHTML =
        `✅ Surface : <strong>${areaHaDisplay} ha</strong> <span style="color:rgba(29,78,216,.6);font-size:.85em;">(${areaM2display} m²)</span> &nbsp;·&nbsp; Périmètre : <strong>${perim.toLocaleString('fr')} m</strong>`;
      if (btnFinish) btnFinish.style.display = 'none';
      checkEnvironmentalZones(state.lat, state.lng);
      setTimeout(() => setMode('surface'), 300);
    }

    if (e.layerType === 'polyline') {
      const lls = e.layer.getLatLngs();
      let dist = 0;
      for (let i = 0; i < lls.length - 1; i++) dist += lls[i].distanceTo(lls[i + 1]);
      dist = Math.round(dist);
      const perimEl = document.getElementById('perimetre');
      if (perimEl) { perimEl.value = dist; state.perimetre = dist; }
      state.geojson = e.layer.toGeoJSON();
      const mid = Math.floor(lls.length / 2);
      state.lat = lls[mid].lat;
      state.lng = lls[mid].lng;
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

// ── VÉRIFICATION ZONES ENVIRONNEMENTALES ─────────────────
async function checkEnvironmentalZones(lat, lng) {
  const zoneEl = document.getElementById('zone-info');
  if (!zoneEl || !lat || !lng) return;

  zoneEl.style.display = 'block';
  zoneEl.innerHTML = '<div class="zone-checking">🔍 Vérification des zones environnementales en cours…</div>';

  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lng, lat] }));
  const base  = 'https://apicarto.ign.fr/api/nature/';

  const checks = [
    {
      url:    `${base}natura-habitat?geom=${geom}`,
      name:   'Natura 2000 – Habitats (ZSC/SIC)',
      icon:   '🐸',
      impact: 'Travaux en eau soumis à évaluation des incidences. Un dossier préalable est généralement requis (délai : 2 à 6 mois).',
    },
    {
      url:    `${base}natura-oiseaux?geom=${geom}`,
      name:   'Natura 2000 – Oiseaux (ZPS)',
      icon:   '🦅',
      impact: 'Zone de protection spéciale. Travaux conditionnés hors période de nidification. Évaluation d\'incidences requise.',
    },
    {
      url:    `${base}znieff1?geom=${geom}`,
      name:   'ZNIEFF de type I',
      icon:   '🌿',
      impact: 'Zone d\'intérêt écologique majeur. Une étude d\'impact peut être demandée lors de l\'instruction du dossier.',
    },
    {
      url:    `${base}znieff2?geom=${geom}`,
      name:   'ZNIEFF de type II',
      icon:   '🌿',
      impact: 'Grand ensemble naturel. Travaux possibles avec précautions environnementales adaptées.',
    },
  ];

  const found  = [];
  let   errors = 0;

  await Promise.allSettled(checks.map(async c => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 9000);
      const res  = await fetch(c.url, { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) { errors++; return; }
      const data = await res.json();
      if (data.features?.length > 0) {
        const props = data.features[0].properties;
        const siteName = props?.sitename || props?.nom_site || props?.nom_zone || props?.nom || '';
        found.push({ ...c, siteName });
      }
    } catch { errors++; }
  }));

  if (found.length === 0 && errors === checks.length) {
    zoneEl.innerHTML = `
      <div class="zone-indispo">
        ⚠️ La vérification automatique des zones environnementales n'a pas abouti (service IGN indisponible).<br>
        <span>Nous effectuerons ce contrôle lors du rendez-vous technique.</span>
      </div>`;
    return;
  }

  if (found.length === 0) {
    zoneEl.innerHTML = `
      <div class="zone-ok">
        ✅ <strong>Aucune zone protégée détectée</strong> (Natura 2000, ZNIEFF) à cette localisation.<br>
        <span>Pensez à vérifier les zones humides locales auprès de votre DDT.</span>
      </div>`;
    return;
  }

  const zonesHtml = found.map(z => `
    <div class="zone-item">
      <div class="zone-item-name">${z.icon} ${z.name}${z.siteName ? ` — <em>${z.siteName}</em>` : ''}</div>
      <div class="zone-item-impact">${z.impact}</div>
    </div>`).join('');

  zoneEl.innerHTML = `
    <div class="zone-alert">
      <div class="zone-alert-title">⚠️ Zone(s) protégée(s) détectée(s) — réglementation spécifique</div>
      ${zonesHtml}
      <div class="zone-alert-footer">
        Ces informations sont indicatives et basées sur les données IGN. Nous vous accompagnons dans toutes les démarches administratives liées à ces zones.
      </div>
      <label class="zone-accomp-label">
        <input type="checkbox" id="cb-accompagnement" />
        <span class="zone-accomp-text">
          <strong>Je souhaite être accompagné(e) dans les démarches administratives</strong>
          <em>Loi sur l'eau · dossier d'incidences Natura 2000 · déclaration préfectorale… Nous prenons en charge les démarches à votre place.</em>
        </span>
      </label>
    </div>`;

  const cb = document.getElementById('cb-accompagnement');
  if (cb) cb.addEventListener('change', () => { state.demandeAccompagnement = cb.checked; });
}

// ── BUILD DETAILS (pour Supabase) ─────────────────────────────
function buildDetails() {
  const d = { typeClient: state.typeClient };
  if (state.travaux.has('hydrocurage')) {
    const vol = Math.max(1, Math.round((state.surface > 0 ? state.surface : 0.5) * 10000 * state.epaisseurHydro / 100));
    d.hydrocurage = {
      epaisseur_cm:      state.epaisseurHydro,
      volume_m3:         vol,
      destination_vase:  state.destinationVaseHydro,
      nature_terrain:    state.destinationVaseHydro === 'sur-place' ? state.natureTerrainHydro : null,
      distance_depot_m:  state.destinationVaseHydro === 'sur-place' ? state.distanceDepotHydro : null,
    };
  }
  if (state.travaux.has('curage'))
    d.curage = { prof_vase_cm: state.profVase, pct_surface: state.pctCurage, destination_vase: state.destinationVase };
  if (state.travaux.has('faucardage'))
    d.faucardage = { pct_couverture: state.pctFauc, jussie: state.faucJussie };
  if (state.travaux.has('berges'))
    d.berges = { longueur_ml: state.lgBerges, type: state.typeBerge };
  if (state.travaux.has('broyage-forestier'))
    d['broyage-forestier'] = { surface_ha: state.surfBroyageForestier, densite: state.densiteBroyage };
  if (state.travaux.has('broyage-roseaux'))
    d['broyage-roseaux'] = { surface_ha: state.surfBroyageRoseaux, avec_ramassage: state.avecRamassage };
  if (state.demandeAccompagnement) d.demandeAccompagnement = true;
  return d;
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
    _cc:         'vandaelemarcel@orange.fr',
    subject:      'contact@curagevandaele.fr',
    from_name:    'Site Curage Vandaele',
    redirect:     'false',
    _autoresponse: 'false',
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
      'Hydrocurage – épaisseur vase estimée (cm)': state.epaisseurHydro,
      'Hydrocurage – volume estimé (m³)': Math.max(1, Math.round((state.surface > 0 ? state.surface : 0.5) * 10000 * state.epaisseurHydro / 100)),
      'Hydrocurage – destination vase': state.destinationVaseHydro === 'evacuation' ? 'Évacuation par nos soins' : `Stockage sur terrain (${state.natureTerrainHydro}, ${state.distanceDepotHydro} m)`,
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
    ...(state.infosSup ? { 'Informations complémentaires': state.infosSup } : {}),
  };

  // Sauvegarde dans Firebase Firestore (dashboard admin)
  if (db) {
    try {
      await db.collection('demandes').add({
        type: 'estimation',
        prenom, nom, email, telephone: tel,
        profil:          document.getElementById('c-profil')?.value || '',
        delai:           document.getElementById('c-delai')?.value  || '',
        adresse:         document.getElementById('adresse')?.value  || '',
        surface_ha:      state.surface   || null,
        perimetre_ml:    state.perimetre || null,
        acces:           state.acces,
        travaux:         [...state.travaux],
        estimation_min:  lastEstMin || null,
        estimation_max:  lastEstMax || null,
        estimation_text: estimation,
        details:         buildDetails(),
        infos_sup:       state.infosSup || null,
        geojson:         state.geojson ? JSON.stringify(state.geojson) : null,
        lat:             state.lat  || (selectedCoords ? selectedCoords[1] : null),
        lng:             state.lng  || (selectedCoords ? selectedCoords[0] : null),
        statut:          'nouveau',
        created_at:      firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error('[Firebase] Sauvegarde demande échouée :', e.code, e.message);
    }
  }

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
