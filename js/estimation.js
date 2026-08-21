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
// mobilisation + modificateurs % = partagés tous profils
// prix de prestation = par profil client (particulier / professionnel / collectivite / association)
let TARIFS = {
  hydrocurage: {
    mobilisation:  { min: 800,  max: 2000 },
    moyen:         20,
    difficile:     40,
    particulier:   { base: { min: 15, max: 30 }, evacuation: { min: 8,  max: 15 } },
    professionnel: { base: { min: 15, max: 30 }, evacuation: { min: 8,  max: 15 } },
    collectivite:  { base: { min: 17, max: 33 }, evacuation: { min: 9,  max: 17 } },
    association:   { base: { min: 15, max: 30 }, evacuation: { min: 8,  max: 15 } },
  },
  curage: {
    mobilisation:  { min: 1200, max: 3000 },
    moyen:         20,
    difficile:     40,
    particulier:   { base: { min: 12, max: 22 }, evacuation: { min: 5,  max: 10 } },
    professionnel: { base: { min: 12, max: 22 }, evacuation: { min: 5,  max: 10 } },
    collectivite:  { base: { min: 13, max: 25 }, evacuation: { min: 6,  max: 12 } },
    association:   { base: { min: 12, max: 22 }, evacuation: { min: 5,  max: 10 } },
  },
  faucardage: {
    mobilisation:  { min: 600,  max: 1500 },
    moyen:         20,
    difficile:     40,
    jussie:        40,
    particulier:   { base: { min: 700, max: 1200 } },
    professionnel: { base: { min: 700, max: 1200 } },
    collectivite:  { base: { min: 770, max: 1320 } },
    association:   { base: { min: 700, max: 1200 } },
  },
  berges: {
    mobilisation:  { min: 800,  max: 2000 },
    particulier:   { enrochement: { min: 150, max: 280 }, palplanche: { min: 200, max: 400 }, gabion: { min: 120, max: 220 }, vegetal: { min: 50,  max: 100 }, conseil: { min: 150, max: 280 } },
    professionnel: { enrochement: { min: 150, max: 280 }, palplanche: { min: 200, max: 400 }, gabion: { min: 120, max: 220 }, vegetal: { min: 50,  max: 100 }, conseil: { min: 150, max: 280 } },
    collectivite:  { enrochement: { min: 165, max: 308 }, palplanche: { min: 220, max: 440 }, gabion: { min: 132, max: 242 }, vegetal: { min: 55,  max: 110 }, conseil: { min: 165, max: 308 } },
    association:   { enrochement: { min: 150, max: 280 }, palplanche: { min: 200, max: 400 }, gabion: { min: 120, max: 220 }, vegetal: { min: 50,  max: 100 }, conseil: { min: 150, max: 280 } },
  },
  'broyage-forestier': {
    mobilisation:  { min: 600,  max: 1500 },
    particulier:   { legere: { min: 900,  max: 1600 }, moyenne: { min: 1500, max: 2800 }, dense: { min: 2500, max: 4500 } },
    professionnel: { legere: { min: 900,  max: 1600 }, moyenne: { min: 1500, max: 2800 }, dense: { min: 2500, max: 4500 } },
    collectivite:  { legere: { min: 990,  max: 1760 }, moyenne: { min: 1650, max: 3080 }, dense: { min: 2750, max: 4950 } },
    association:   { legere: { min: 900,  max: 1600 }, moyenne: { min: 1500, max: 2800 }, dense: { min: 2500, max: 4500 } },
  },
  'broyage-roseaux': {
    mobilisation:  { min: 500,  max: 1200 },
    moyen:         30,
    difficile:     60,
    ramassage:     80,
    particulier:   { base: { min: 500, max: 800 } },
    professionnel: { base: { min: 500, max: 800 } },
    collectivite:  { base: { min: 550, max: 880 } },
    association:   { base: { min: 500, max: 800 } },
  },
  diagnostic: { min: 0, max: 0 },
};

// Charge les tarifs depuis Firestore si disponible (admin peut les modifier)
if (typeof db !== 'undefined' && db) {
  db.collection('config').doc('tarifs').get().then(snap => {
    if (snap.exists) {
      const data = snap.data();
      // Ignorer si ancien format (avant structure par profil client)
      if (data.hydrocurage?.particulier?.base) {
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
  // Épandage
  epandageSurfaceHydro: null,
  epandageCentroidHydro: null,
  epandageGeojsonHydro: null,
  epandageSurfaceCurage: null,
  epandageCentroidCurage: null,
  epandageGeojsonCurage: null,
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
  // Zone de travaux
  zoneType: 'etang',
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
  if (n === 2) renderProblems();
  if (n === 4) {
    syncDetailSections();
    setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 50);
  }
  if (n === 5) updatePanel5Fields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  computeEstimation();
}

// ── ZONE CONFIG (problèmes affichés selon type de zone) ───────
const ZONE_CONFIG = {
  etang: {
    title: '🔎 Problèmes rencontrés sur votre étang',
    subtitle: 'Cochez tout ce que vous observez. Nous présélectionnerons les travaux adaptés — vous pourrez les ajuster.',
    problems: [
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Manque de profondeur / envasement',       desc: 'Le fond remonte, l\'eau est peu profonde' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Plantes aquatiques envahissantes',          desc: 'Nénuphars, herbiers, algues en surface' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux qui colonisent les berges',        desc: 'Phragmites ou massettes qui s\'étendent' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges qui s\'effondrent ou s\'érodent',    desc: 'Affaissements, éboulements de talus' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Végétation ligneuse envahissante',          desc: 'Arbres/arbustes qui empiètent sur les berges' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Je ne sais pas — besoin d\'un expert',     desc: 'Diagnostic gratuit sur place' },
    ],
  },
  'etangs-multiples': {
    title: '🔎 Problèmes rencontrés sur vos étangs',
    subtitle: 'Cochez les problèmes observés — ils peuvent concerner un ou plusieurs étangs.',
    problems: [
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Manque de profondeur / envasement',       desc: 'Un ou plusieurs bassins ensablés' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Plantes aquatiques envahissantes',          desc: 'Nénuphars, herbiers, algues' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux sur les berges',                   desc: 'Colonisation des bords' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges dégradées',                         desc: 'Effondrements, érosion des talus' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Végétation ligneuse',                       desc: 'Arbres/arbustes à débroussailler' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Besoin d\'un diagnostic global',           desc: 'Visite technique gratuite' },
    ],
  },
  riviere: {
    title: '🔎 Problèmes rencontrés sur votre cours d\'eau',
    subtitle: 'Cochez les problèmes observés sur la rivière ou le ruisseau.',
    problems: [
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Lit encombré / envasé',                    desc: 'Accumulation de vase, manque de débit' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Végétation aquatique dense',                desc: 'Plantes qui freinent l\'écoulement' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux sur les berges',                   desc: 'Colonisation des rives' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges qui s\'érodent',                    desc: 'Affouillement, éboulements de rive' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Embâcles / végétation ligneuse',           desc: 'Arbres tombés, branches obstruant le lit' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Besoin d\'un diagnostic',                  desc: 'Visite technique gratuite' },
    ],
  },
  fosse: {
    title: '🔎 Problèmes rencontrés sur votre fossé / canal',
    subtitle: 'Cochez les problèmes observés.',
    problems: [
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Fossé colmaté / envasé',                   desc: 'Mauvaise évacuation des eaux' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Végétation qui obstrue',                    desc: 'Herbes, lentilles d\'eau, algues' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux envahissants',                     desc: 'Colonisation des berges du fossé' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Talus abîmés',                             desc: 'Berges affaissées ou érodées' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Végétation ligneuse sur les bords',        desc: 'Broussailles, arbres à abattre' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Besoin d\'un diagnostic',                  desc: 'Visite technique gratuite' },
    ],
  },
  marais: {
    title: '🔎 Problèmes rencontrés sur votre zone humide',
    subtitle: 'Cochez les situations observées sur la zone marais.',
    problems: [
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux / roselières trop denses',         desc: 'Extension incontrôlée des phragmites' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Lignification de la zone humide',           desc: 'Arbres/arbustes qui colonisent le marais' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Plantes envahissantes (jussie, etc.)',       desc: 'Espèces invasives à contrôler' },
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Atterrissement / envasement',              desc: 'Perte de surface en eau' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges dégradées',                         desc: 'Effondrements de talus' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Besoin d\'un diagnostic',                  desc: 'Visite technique gratuite' },
    ],
  },
  boisement: {
    title: '🔎 Travaux souhaités sur votre zone boisée',
    subtitle: 'Cochez les travaux ou problèmes identifiés sur la zone.',
    problems: [
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Débroussaillage / broyage forestier',      desc: 'Végétation ligneuse à abattre et broyer' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux ou fougères envahissants',         desc: 'Végétation basse dense' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges boisées à sécuriser',               desc: 'Talus à renforcer ou à stabiliser' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Besoin d\'un diagnostic / devis',          desc: 'Visite technique gratuite' },
    ],
  },
  autre: {
    title: '🔎 Décrivez votre situation',
    subtitle: 'Cochez les problèmes les plus proches de votre situation — nous adapterons notre proposition.',
    problems: [
      { id: 'envase',    img: 'assets/img/curage-mecanique-1.jpg',                     label: 'Envasement / accumulation de vase',       desc: 'Fond qui remonte, eau peu profonde' },
      { id: 'vegetation',img: 'assets/img/faucardage-et-suppression-de-vegetation.jpg',label: 'Végétation aquatique envahissante',         desc: 'Plantes qui couvrent la surface' },
      { id: 'roseaux',   img: 'assets/img/fauchage-de-roseaux-avec-exportation.jpg',   label: 'Roseaux / végétation dense',               desc: 'Colonisation des berges' },
      { id: 'berges',    img: 'assets/img/defense-de-berges-1.jpg',                    label: 'Berges dégradées',                         desc: 'Effondrements, érosion' },
      { id: 'boisement', img: 'assets/img/travaux-en-marais.jpg',                      label: 'Végétation ligneuse',                       desc: 'Arbres/arbustes à gérer' },
      { id: 'inconnu',   img: 'assets/img/diagnostic-terrain.jpg',                     label: 'Autre / besoin d\'un expert',              desc: 'Diagnostic gratuit sur place' },
    ],
  },
};

function renderProblems() {
  const cfg = ZONE_CONFIG[state.zoneType] || ZONE_CONFIG.etang;
  const grid = document.getElementById('problemes-grid');
  const title = document.getElementById('panel2-title');
  const subtitle = document.getElementById('panel2-subtitle');
  if (title) title.textContent = cfg.title;
  if (subtitle) subtitle.textContent = cfg.subtitle;
  if (!grid) return;
  grid.innerHTML = cfg.problems.map(p => `
    <div class="probleme-toggle">
      <input type="checkbox" id="p-${p.id}" name="problemes" value="${p.id}" />
      <label for="p-${p.id}">
        <img class="prob-img" src="${p.img}" alt="${p.label}" loading="lazy" />
        <span class="prob-text">${p.label}<span class="prob-desc">${p.desc}</span></span>
      </label>
    </div>
  `).join('');
}

// ── PROBLÈMES → TRAVAUX ───────────────────────────────────────
const PROBLEM_MAP = {
  envase:     ['curage', 'hydrocurage'],
  vegetation: ['faucardage'],
  roseaux:    ['broyage-roseaux'],
  berges:     ['berges'],
  boisement:  ['broyage-forestier'],
  inconnu:    ['diagnostic'],
};

window.applyProblems = function() {
  const checked = document.querySelectorAll('input[name="problemes"]:checked');
  const recommended = new Set();
  checked.forEach(cb => (PROBLEM_MAP[cb.value] || []).forEach(t => recommended.add(t)));
  if (!recommended.size) recommended.add('diagnostic');

  document.querySelectorAll('input[name="travaux"]').forEach(cb => {
    const should = recommended.has(cb.value);
    cb.checked = should;
    if (should) state.travaux.add(cb.value);
    else state.travaux.delete(cb.value);
  });

  const note = document.getElementById('guided-note');
  if (note) note.style.display = checked.length ? '' : 'none';

  computeEstimation();
  goToPanel(3);
};

// ── CHAMPS DYNAMIQUES PANEL 5 ─────────────────────────────────
function updatePanel5Fields() {
  const tc = state.typeClient;
  const orgFields = document.getElementById('org-fields');
  const orgLabel  = document.getElementById('c-org-label');
  const orgInput  = document.getElementById('c-org');
  const title     = document.getElementById('panel5-title');

  if (tc === 'particulier') {
    if (orgFields) orgFields.classList.remove('visible');
  } else {
    if (orgFields) orgFields.classList.add('visible');
    const labels = { professionnel: 'Nom de la société *', collectivite: 'Nom de la collectivité *', association: "Nom de l'association *" };
    const placeholders = { professionnel: 'Ex : SARL Martin Pêche, EARL Dupont…', collectivite: 'Ex : Mairie de Beaumont, CC du Ternois…', association: 'Ex : Association des pêcheurs du Ternois…' };
    if (orgLabel) orgLabel.textContent = labels[tc] || 'Nom de la structure *';
    if (orgInput) orgInput.placeholder = placeholders[tc] || '';
  }

  const titles = { particulier: '👤 Vos coordonnées', professionnel: '🏢 Coordonnées professionnelles', collectivite: '🏛️ Coordonnées de la collectivité', association: "🤝 Coordonnées de l'association" };
  if (title) title.textContent = titles[tc] || '👤 Vos coordonnées';
}

// ── SYNC DETAIL SECTIONS ──────────────────────────────────────
function syncDetailSections() {
  ['hydrocurage', 'curage', 'faucardage', 'berges', 'broyage-forestier', 'broyage-roseaux', 'diagnostic'].forEach(t => {
    const sec = document.getElementById('detail-' + t);
    if (sec) sec.classList.toggle('visible', state.travaux.has(t));
  });
  // Sync épandage sections based on current destination selections
  if (state.travaux.has('hydrocurage'))
    toggleEpandageSection('hydro', state.destinationVaseHydro === 'sur-place');
  if (state.travaux.has('curage'))
    toggleEpandageSection('curage', state.destinationVase === 'sur-place');
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

document.querySelectorAll('input[name="zone-type"]').forEach(r => {
  r.addEventListener('change', () => {
    state.zoneType = r.value;
  });
});

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
if (destVaseEl) destVaseEl.addEventListener('change', () => {
  state.destinationVase = destVaseEl.value;
  toggleEpandageSection('curage', destVaseEl.value === 'sur-place');
  computeEstimation();
});

document.querySelectorAll('input[name="dest-vase-hydro"]').forEach(r => {
  r.addEventListener('change', () => {
    state.destinationVaseHydro = r.value;
    const stockDetails = document.getElementById('hydro-stock-details');
    if (stockDetails) stockDetails.style.display = r.value === 'sur-place' ? '' : 'none';
    toggleEpandageSection('hydro', r.value === 'sur-place');
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

  const tc_ = svc => TARIFS[svc][state.typeClient] ?? TARIFS[svc].particulier;

  // HYDROCURAGE
  if (state.travaux.has('hydrocurage')) {
    hasTravaux = true;
    const t = TARIFS.hydrocurage;
    const tc = tc_('hydrocurage');
    addMobi(t, 'pompe / hydrocureur');
    const surfM2 = (state.surface > 0 ? state.surface : 0.5) * 10000;
    const vol = Math.max(1, Math.round(surfM2 * (state.epaisseurHydro / 100)));
    const m = accMod(t, acces);
    let cMin = vol * tc.base.min * m;
    let cMax = vol * tc.base.max * m;
    if (state.destinationVaseHydro === 'evacuation' && tc.evacuation) {
      cMin += vol * tc.evacuation.min;
      cMax += vol * tc.evacuation.max;
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
    const tc = tc_('curage');
    addMobi(t, 'drague / pelle amphibie');
    const surf = state.surface > 0 ? state.surface : 0.5;
    const surfM2 = surf * 10000 * (state.pctCurage / 100);
    const profM = state.profVase / 100;
    const volM3 = surfM2 * profM;
    const m = accMod(t, acces);
    let cMin = volM3 * tc.base.min * m;
    let cMax = volM3 * tc.base.max * m;
    if ((state.destinationVase === 'evacuation' || state.destinationVase === 'valorisation') && tc.evacuation) {
      cMin += volM3 * tc.evacuation.min;
      cMax += volM3 * tc.evacuation.max;
    }
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Curage mécanique (~${Math.round(volM3).toLocaleString('fr')} m³)`, val: fmtRange(cMin, cMax) });
  }

  // FAUCARDAGE
  if (state.travaux.has('faucardage')) {
    hasTravaux = true;
    const t = TARIFS.faucardage;
    const tc = tc_('faucardage');
    addMobi(t, 'bateau faucardeur');
    const surf = (state.surface > 0 ? state.surface : 0.5) * (state.pctFauc / 100);
    const m = accMod(t, acces) * (state.faucJussie ? (1 + (t.jussie || 0) / 100) : 1);
    const cMin = surf * tc.base.min * m;
    const cMax = surf * tc.base.max * m;
    totalMin += cMin; totalMax += cMax;
    lines.push({ label: `Faucardage (~${surf.toFixed(2)} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DÉFENSES DE BERGES
  if (state.travaux.has('berges')) {
    hasTravaux = true;
    const t = TARIFS.berges;
    const tc = tc_('berges');
    addMobi(t, 'pelle + matériaux');
    const tp = tc[state.typeBerge] || tc.conseil;
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
    const tc = tc_('broyage-forestier');
    addMobi(t, 'broyeur forestier');
    const tp = tc[state.densiteBroyage] || tc.moyenne;
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
    const tc = tc_('broyage-roseaux');
    addMobi(t, 'bateau + broyeur');
    const surf = state.surfBroyageRoseaux;
    const m = accMod(t, acces) * (state.avecRamassage ? (1 + (t.ramassage || 0) / 100) : 1);
    const cMin = surf * tc.base.min * m;
    const cMax = surf * tc.base.max * m;
    totalMin += cMin; totalMax += cMax;
    const label = state.avecRamassage ? 'Roseaux + ramassage' : 'Broyage roseaux';
    lines.push({ label: `${label} (${surf.toLocaleString('fr')} ha)`, val: fmtRange(cMin, cMax) });
  }

  // DIAGNOSTIC
  if (state.travaux.has('diagnostic')) {
    hasTravaux = true;
    lines.push({ label: 'Diagnostic & visite technique', val: 'Gratuit' });
  }

  const isTtcNote = state.typeClient === 'professionnel' || state.typeClient === 'collectivite';

  // Render
  const linesEl = document.getElementById('result-lines');
  const totalEl = document.getElementById('result-total-amount');
  if (!linesEl || !totalEl) return;

  if (!hasTravaux) {
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

  updateEpandageInfo('hydro');
  updateEpandageInfo('curage');
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
let leafletMap = null;
const mapEl = document.getElementById('leaflet-map');
if (mapEl && typeof L !== 'undefined') {

  const map = L.map('leaflet-map', { zoomControl: true }).setView([46.8, 2.3], 6);
  leafletMap = map;

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

  // ── TERMINER LE TRACÉ (bouton "Terminer") ──────────────────────
  function finishCurrentDrawing() {
    if (drawPolygon._enabled) {
      if ((drawPolygon._markers || []).length < 3) {
        if (infoBar) infoBar.innerHTML = '⚠️ Tracez au moins 3 points pour créer une surface.';
        return;
      }
      drawPolygon._finishShape();
      return;
    }
    if (drawPolyline._enabled) {
      if ((drawPolyline._markers || []).length < 2) {
        if (infoBar) infoBar.innerHTML = '⚠️ Tracez au moins 2 points pour mesurer les berges.';
        return;
      }
      drawPolyline._finishShape();
    }
  }

  // Remet l'UI en état neutre sans ré-activer le dessin
  function resetDrawingUI() {
    drawPolygon.disable();
    drawPolyline.disable();
    btnSurface && btnSurface.classList.remove('active-surface');
    btnBerges  && btnBerges.classList.remove('active-berges');
    if (btnFinish) btnFinish.style.display = 'none';
  }

  // Override _finishShape on both draw tools so disable() (which clears guide dashes)
  // runs BEFORE draw:created fires, regardless of how the drawing is finished.
  drawPolygon._finishShape = function() {
    const pts = (this._markers || []).map(m => m.getLatLng());
    if (pts.length < 3) return;
    this.disable();
    const layer = L.polygon([pts], { color: '#3d9e62', fillColor: '#3d9e62', fillOpacity: 0.15, weight: 2 });
    map.fire(L.Draw.Event.CREATED, { layer, layerType: 'polygon' });
  };

  drawPolyline._finishShape = function() {
    const pts = (this._markers || []).map(m => m.getLatLng());
    if (pts.length < 2) return;
    this.disable();
    const layer = L.polyline(pts, { color: '#56B57A', weight: 3 });
    map.fire(L.Draw.Event.CREATED, { layer, layerType: 'polyline' });
  };

  if (btnSurface) btnSurface.addEventListener('click', () => setMode('surface'));
  if (btnBerges)  btnBerges.addEventListener('click',  () => setMode('berges'));
  if (btnReset)   btnReset.addEventListener('click', () => {
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

  // Intercepte le clic sur le 1er sommet dès que ≥3 points existent.
  // On remplace le handler natif Leaflet.draw (_finishShape) par notre
  // finishCurrentDrawing() qui désactive l'outil AVANT de créer le polygone,
  // ce qui garantit la suppression des guides avant l'événement draw:created.
  map.on('draw:drawvertex', () => {
    if (!drawPolygon._enabled || !drawPolygon._markers || drawPolygon._markers.length < 3) return;
    const firstMarker = drawPolygon._markers[0];
    firstMarker.off('click').on('click', ev => {
      L.DomEvent.stop(ev);
      finishCurrentDrawing();
    });
  });

  map.on(L.Draw.Event.CREATED, e => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);

    if (e.layerType === 'polygon') {
      try {
        const raw = e.layer.getLatLngs();
        const lls = Array.isArray(raw[0]) ? raw[0] : raw;
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
          `✅ Surface : <strong>${areaHaDisplay} ha</strong> <span style="color:rgba(29,78,216,.6);font-size:.85em;">(${areaM2display} m²)</span> &nbsp;·&nbsp; Périmètre : <strong>${perim.toLocaleString('fr')} m</strong> &nbsp;·&nbsp; <span style="font-size:.85em;">⬇️ Vérification des zones en cours…</span>`;
        resetDrawingUI();
        checkEnvironmentalZones(state.lat, state.lng);
      } catch(err) {
        if (infoBar) infoBar.innerHTML = '⚠️ Erreur lors du calcul — veuillez retracez le polygone.';
        console.error('[draw:created]', err);
        resetDrawingUI();
      }
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
      if (infoBar) infoBar.innerHTML = `✅ Longueur tracée : <strong>${dist.toLocaleString('fr')} m</strong> &nbsp;·&nbsp; <span style="font-size:.85em;">⬇️ Vérification des zones en cours…</span>`;
      resetDrawingUI();
      checkEnvironmentalZones(state.lat, state.lng);
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

// ── CARTES ÉPANDAGE ────────────────────────────────────────────
const epandageMaps = {};

function calcEpandageVol(type) {
  const surfM2 = (state.surface > 0 ? state.surface : 0) * 10000;
  if (!surfM2) return 0;
  if (type === 'hydro')
    return Math.round(surfM2 * state.epaisseurHydro / 100);
  return Math.round(surfM2 * (state.pctCurage / 100) * (state.profVase / 100));
}

function updateEpandageInfo(type) {
  const vol = calcEpandageVol(type);
  const minSurf = vol > 0 ? Math.ceil(vol / 0.30 * 1.2 / 100) * 100 : 0;
  const volEl  = document.getElementById(`epandage-vol-${type}`);
  const minEl  = document.getElementById(`epandage-min-${type}`);
  if (volEl) volEl.textContent = vol > 0 ? `${vol.toLocaleString('fr-FR')} m³` : '–';
  if (minEl) minEl.textContent = minSurf > 0
    ? `${minSurf.toLocaleString('fr-FR')} m² (${(minSurf / 10000).toFixed(2)} ha)`
    : '–';
}

function toggleEpandageSection(type, show) {
  if (type === 'curage') {
    const wrap = document.getElementById('curage-epandage-wrap');
    if (wrap) wrap.hidden = !show;
  }
  if (show) {
    updateEpandageInfo(type);
    // Only init map if user has "j'ai un terrain" selected
    const radio = document.querySelector(`input[name="epandage-dispo-${type}"]:checked`);
    if (!radio || radio.value === 'oui') {
      setTimeout(() => initEpandageMap(type), 80);
    }
  }
}

function initEpandageMap(type) {
  if (!window.L) return;
  const mapEl = document.getElementById(`map-epandage-${type}`);
  if (!mapEl) return;
  if (epandageMaps[type]) {
    epandageMaps[type].map.invalidateSize();
    return;
  }
  const lat  = state.lat  || 46.8;
  const lng  = state.lng  || 2.3;
  const zoom = state.lat  ? 16 : 6;

  const m = L.map(`map-epandage-${type}`, { zoomControl: true }).setView([lat, lng], zoom);
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&FORMAT=image%2Fjpeg&STYLE=normal',
    { attribution: '© IGN', maxZoom: 21, maxNativeZoom: 19 }
  ).addTo(m);

  const drawnItems = new L.FeatureGroup().addTo(m);

  m.on(L.Draw.Event.CREATED, e => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    const lls  = e.layer.getLatLngs()[0];
    const area   = Math.round(L.GeometryUtil.geodesicArea(lls));
    const bounds = e.layer.getBounds();
    const center = bounds.getCenter();
    const geojsonEp = e.layer.toGeoJSON();
    if (type === 'hydro') {
      state.epandageSurfaceHydro  = area;
      state.epandageCentroidHydro = { lat: center.lat, lng: center.lng };
      state.epandageGeojsonHydro  = geojsonEp;
    } else {
      state.epandageSurfaceCurage  = area;
      state.epandageCentroidCurage = { lat: center.lat, lng: center.lng };
      state.epandageGeojsonCurage  = geojsonEp;
    }
    const valEl = document.getElementById(`epandage-surface-${type}-val`);
    const resEl = document.getElementById(`epandage-result-${type}`);
    if (valEl) valEl.textContent = `${area.toLocaleString('fr-FR')} m² (${(area / 10000).toFixed(2)} ha)`;
    if (resEl) resEl.hidden = false;
    checkEpandageZones(type, center.lat, center.lng);
  });

  epandageMaps[type] = { map: m, drawnItems };
  setTimeout(() => m.invalidateSize(), 100);
}

window.startEpandageDraw = function(type) {
  if (!epandageMaps[type]) { initEpandageMap(type); return; }
  const { map } = epandageMaps[type];
  new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    metric: true,
    shapeOptions: { color: '#3d9e62', weight: 2, fillOpacity: 0.15 },
  }).enable();
};

window.resetEpandageMap = function(type) {
  const m = epandageMaps[type];
  if (m) m.drawnItems.clearLayers();
  if (type === 'hydro') {
    state.epandageSurfaceHydro  = null;
    state.epandageCentroidHydro = null;
    state.epandageGeojsonHydro  = null;
  } else {
    state.epandageSurfaceCurage  = null;
    state.epandageCentroidCurage = null;
    state.epandageGeojsonCurage  = null;
  }
  const resEl = document.getElementById(`epandage-result-${type}`);
  if (resEl) resEl.hidden = true;
  const zoneEl = document.getElementById(`epandage-zone-${type}`);
  if (zoneEl) { zoneEl.hidden = true; zoneEl.innerHTML = ''; }
};

async function checkEpandageZones(type, lat, lng) {
  const zoneEl = document.getElementById(`epandage-zone-${type}`);
  if (!zoneEl || !lat || !lng) return;
  zoneEl.hidden = false;
  zoneEl.innerHTML = '<div class="zone-checking">🔍 Vérification des zones réglementaires en cours…</div>';

  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lng, lat] }));
  const base  = 'https://apicarto.ign.fr/api/nature/';
  const checks = [
    { url: `${base}zone-humide?geom=${geom}`,  icon: '💧', name: 'Zone humide',   impact: 'Épandage soumis à autorisation préfectorale (Loi sur l\'eau).' },
    { url: `${base}natura-habitat?geom=${geom}`, icon: '🌿', name: 'Natura 2000 (Habitats)', impact: 'Étude d\'incidences Natura 2000 potentiellement requise.' },
    { url: `${base}natura-oiseaux?geom=${geom}`, icon: '🦅', name: 'Natura 2000 (Oiseaux)',  impact: 'Étude d\'incidences Natura 2000 potentiellement requise.' },
    { url: `${base}znieff1?geom=${geom}`,        icon: '🔬', name: 'ZNIEFF type I',          impact: 'Zone naturelle sensible — vérifier la compatibilité du projet.' },
    { url: `${base}znieff2?geom=${geom}`,        icon: '🌲', name: 'ZNIEFF type II',         impact: 'Zone naturelle d\'inventaire — contraintes réglementaires possibles.' },
  ];
  try {
    const results = await Promise.allSettled(checks.map(c => fetch(c.url).then(r => r.json())));
    const found = results
      .map((r, i) => ({ ...checks[i], features: r.status === 'fulfilled' ? (r.value.features || []) : [] }))
      .filter(c => c.features.length > 0);
    if (!found.length) {
      zoneEl.innerHTML = '<div class="zone-ok">✅ Aucune zone réglementaire détectée sur cette parcelle.</div>';
    } else {
      zoneEl.innerHTML = `<div class="zone-alert">
        <div class="zone-alert-title">⚠️ Zone(s) réglementaire(s) sur la parcelle d'épandage</div>
        ${found.map(z => `<div class="zone-item">
          <div class="zone-item-name">${z.icon} ${z.name}</div>
          <div class="zone-item-impact">${z.impact}</div>
        </div>`).join('')}
        <div class="zone-alert-footer">Nous vous accompagnons dans les démarches administratives nécessaires.</div>
      </div>`;
    }
  } catch {
    zoneEl.innerHTML = '';
    zoneEl.hidden = true;
  }
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
      url:    `${base}zone-humide?geom=${geom}`,
      name:   'Zone humide (Loi sur l\'eau)',
      icon:   '💧',
      type:   'zh',
      impact: `Tout remblai, assèchement ou travaux affectant une zone humide est soumis à déclaration (> 0,1 ha) ou autorisation préfectorale (> 1 ha) au titre de la rubrique 3.3.1.0 du Code de l'environnement (<abbr title="Installations, Ouvrages, Travaux et Activités">IOTA</abbr>). Un dossier Loi sur l'eau est obligatoire avant tout démarrage de chantier.`,
    },
    {
      url:    `${base}natura-habitat?geom=${geom}`,
      name:   'Natura 2000 – Habitats (<abbr title="Zone Spéciale de Conservation">ZSC</abbr>/<abbr title="Site d\'Importance Communautaire">SIC</abbr>)',
      icon:   '🐸',
      type:   'eco',
      impact: `Travaux en eau soumis à <abbr title="Évaluation des Incidences Natura 2000">évaluation des incidences Natura 2000 (EIN)</abbr>. Un dossier préalable est généralement requis (délai : 2 à 6 mois).`,
    },
    {
      url:    `${base}natura-oiseaux?geom=${geom}`,
      name:   'Natura 2000 – Oiseaux (<abbr title="Zone de Protection Spéciale">ZPS</abbr>)',
      icon:   '🦅',
      type:   'eco',
      impact: `<abbr title="Zone de Protection Spéciale">Zone de protection spéciale (ZPS)</abbr>. Travaux conditionnés hors période de nidification. <abbr title="Évaluation des Incidences Natura 2000">Évaluation d'incidences (EIN)</abbr> requise.`,
    },
    {
      url:    `${base}znieff1?geom=${geom}`,
      name:   '<abbr title="Zone Naturelle d\'Intérêt Écologique, Faunistique et Floristique">ZNIEFF</abbr> de type I',
      icon:   '🌿',
      type:   'eco',
      impact: `<abbr title="Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique">Zone Naturelle d'Intérêt Écologique (ZNIEFF)</abbr> de type I — intérêt écologique majeur. Une étude d'impact peut être demandée lors de l'instruction du dossier.`,
    },
    {
      url:    `${base}znieff2?geom=${geom}`,
      name:   '<abbr title="Zone Naturelle d\'Intérêt Écologique, Faunistique et Floristique">ZNIEFF</abbr> de type II',
      icon:   '🌿',
      type:   'eco',
      impact: `<abbr title="Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique">Zone Naturelle d'Intérêt Écologique (ZNIEFF)</abbr> de type II — grand ensemble naturel. Travaux possibles avec précautions environnementales adaptées.`,
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
        const siteName = props?.sitename || props?.nom_site || props?.nom_zone || props?.nom
          || props?.code_zh || props?.lb_zh || props?.type_zh || '';
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
    zoneEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  if (found.length === 0) {
    zoneEl.innerHTML = `
      <div class="zone-ok">
        ✅ <strong>Aucune zone protégée détectée</strong> (zone humide, Natura 2000, <abbr title="Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique">ZNIEFF</abbr>) à cette localisation.<br>
        <span>Ces données sont indicatives — vérification définitive lors de la visite technique.</span>
      </div>`;
    zoneEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const zhFound  = found.filter(z => z.type === 'zh');
  const ecoFound = found.filter(z => z.type === 'eco');

  const zhHtml = zhFound.length > 0 ? `
    <div class="zone-alert zone-alert-zh">
      <div class="zone-alert-title">💧 Zone humide détectée — Loi sur l'eau applicable</div>
      ${zhFound.map(z => `
        <div class="zone-item">
          <div class="zone-item-name">${z.name}${z.siteName ? ` — <em>${z.siteName}</em>` : ''}</div>
          <div class="zone-item-impact">${z.impact}</div>
        </div>`).join('')}
    </div>` : '';

  const ecoHtml = ecoFound.length > 0 ? `
    <div class="zone-alert${zhFound.length > 0 ? ' zone-alert-mt' : ''}">
      <div class="zone-alert-title">⚠️ Zone(s) écologique(s) protégée(s) — réglementation spécifique</div>
      ${ecoFound.map(z => `
        <div class="zone-item">
          <div class="zone-item-name">${z.icon} ${z.name}${z.siteName ? ` — <em>${z.siteName}</em>` : ''}</div>
          <div class="zone-item-impact">${z.impact}</div>
        </div>`).join('')}
    </div>` : '';

  const accompHtml = `
    <label class="zone-accomp-label" style="margin-top:.5rem;">
      <input type="checkbox" id="cb-accompagnement" />
      <span class="zone-accomp-text">
        <strong>Je souhaite être accompagné(e) dans les démarches administratives</strong>
        <em>Dossier Loi sur l'eau · évaluation d'incidences Natura 2000 · déclaration préfectorale… Nous prenons en charge les démarches à votre place.</em>
      </span>
    </label>`;

  zoneEl.innerHTML = zhHtml + ecoHtml + `
    <div class="zone-alert-footer-global">
      Ces informations sont basées sur les données IGN et sont indicatives. La vérification définitive est effectuée lors de la visite technique.
    </div>
    <div class="zone-glossaire">
      <strong>Sigles</strong> :
      <abbr title="Installations, Ouvrages, Travaux et Activités">IOTA</abbr> (régime Loi sur l'eau) ·
      <abbr title="Évaluation des Incidences Natura 2000">EIN</abbr> ·
      <abbr title="Zone Spéciale de Conservation">ZSC</abbr> ·
      <abbr title="Site d'Importance Communautaire">SIC</abbr> ·
      <abbr title="Zone de Protection Spéciale">ZPS</abbr> ·
      <abbr title="Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique">ZNIEFF</abbr>
    </div>` + accompHtml;

  zoneEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const cb = document.getElementById('cb-accompagnement');
  if (cb) cb.addEventListener('change', () => { state.demandeAccompagnement = cb.checked; });
}

// ── BUILD DETAILS (pour Supabase) ─────────────────────────────
function buildDetails() {
  const d = { typeClient: state.typeClient };
  if (state.travaux.has('hydrocurage')) {
    const vol = Math.max(1, Math.round((state.surface > 0 ? state.surface : 0.5) * 10000 * state.epaisseurHydro / 100));
    d.hydrocurage = {
      epaisseur_cm:          state.epaisseurHydro,
      volume_m3:             vol,
      destination_vase:      state.destinationVaseHydro,
      nature_terrain:        state.destinationVaseHydro === 'sur-place' ? state.natureTerrainHydro : null,
      distance_depot_m:      state.destinationVaseHydro === 'sur-place' ? state.distanceDepotHydro : null,
      epandage_surface_m2:   state.destinationVaseHydro === 'sur-place' ? state.epandageSurfaceHydro : null,
    };
  }
  if (state.travaux.has('curage'))
    d.curage = {
      prof_vase_cm:        state.profVase,
      pct_surface:         state.pctCurage,
      destination_vase:    state.destinationVase,
      epandage_surface_m2: state.destinationVase === 'sur-place' ? state.epandageSurfaceCurage : null,
    };
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
    'Type client': state.typeClient,
    'Zone de travaux': state.zoneType,
    ...(state.typeClient !== 'particulier' ? {
      Organisation: document.getElementById('c-org')?.value?.trim() || '',
      Fonction:     document.getElementById('c-fonction')?.value?.trim() || '',
    } : {}),
    Délai:       document.getElementById('c-delai')?.value || '',
    'Adresse chantier':       document.getElementById('adresse')?.value || 'Non renseignée',
    'Surface (ha)':           state.surface  || 'Non mesurée',
    'Périmètre (ml)':         state.perimetre || 'Non mesuré',
    'Accès chantier':         state.acces,
    'Type de travaux':        travaux,
    'Estimation indicative':  estimation,
    ...(state.travaux.has('hydrocurage') ? (() => {
      const dispoHydro = document.querySelector('input[name="epandage-dispo-hydro"]:checked')?.value || 'oui';
      const vol = Math.max(1, Math.round((state.surface > 0 ? state.surface : 0.5) * 10000 * state.epaisseurHydro / 100));
      return {
        'Hydrocurage – épaisseur vase estimée (cm)': state.epaisseurHydro,
        'Hydrocurage – volume estimé (m³)': vol,
        'Hydrocurage – destination vase': state.destinationVaseHydro === 'evacuation' ? 'Évacuation par nos soins' : `Stockage sur terrain (${state.natureTerrainHydro}, ${state.distanceDepotHydro} m)`,
        ...(state.destinationVaseHydro === 'sur-place' ? {
          'Hydrocurage – terrain épandage disponible': dispoHydro === 'oui' ? 'Oui' : 'Non – pas de terrain disponible',
          ...(state.epandageSurfaceHydro ? { 'Hydrocurage – surface épandage mesurée (m²)': state.epandageSurfaceHydro } : {}),
        } : {}),
      };
    })() : {}),
    ...(state.travaux.has('curage') ? (() => {
      const dispoCurage = document.querySelector('input[name="epandage-dispo-curage"]:checked')?.value || 'oui';
      return {
        'Curage – prof. vase (cm)':   state.profVase,
        'Curage – % surface':         state.pctCurage,
        'Curage – destination vase':  state.destinationVase,
        ...(state.destinationVase === 'sur-place' ? {
          'Curage – terrain épandage disponible': dispoCurage === 'oui' ? 'Oui' : 'Non – pas de terrain disponible',
          ...(state.epandageSurfaceCurage ? { 'Curage – surface épandage mesurée (m²)': state.epandageSurfaceCurage } : {}),
        } : {}),
      };
    })() : {}),
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
        type_client:     state.typeClient,
        zone_type:       state.zoneType,
        organisation:    document.getElementById('c-org')?.value?.trim() || '',
        fonction:        document.getElementById('c-fonction')?.value?.trim() || '',
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
        geojson_epandage_hydro:  state.epandageGeojsonHydro  ? JSON.stringify(state.epandageGeojsonHydro)  : null,
        lat_epandage_hydro:      state.epandageCentroidHydro?.lat  || null,
        lng_epandage_hydro:      state.epandageCentroidHydro?.lng  || null,
        geojson_epandage_curage: state.epandageGeojsonCurage ? JSON.stringify(state.epandageGeojsonCurage) : null,
        lat_epandage_curage:     state.epandageCentroidCurage?.lat || null,
        lng_epandage_curage:     state.epandageCentroidCurage?.lng || null,
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
