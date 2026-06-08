/* ============================================================
   CURAGE VANDAELE – ADMIN JS (Firebase)
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCedrdegva_01oxW1zqhMX-qrRdn_Xczjc',
  authDomain:        'curage-vandaele.firebaseapp.com',
  projectId:         'curage-vandaele',
  storageBucket:     'curage-vandaele.firebasestorage.app',
  messagingSenderId: '391514836726',
  appId:             '1:391514836726:web:357672b95b8af8275426d7',
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

const DEPOT_LAT = 50.4167;
const DEPOT_LNG = 1.9833;

let allDemandes   = [];
let currentFilter = 'all';
let currentSearch = '';
let adminMap      = null;
let routeMap      = null;
let currentSort   = 'desc';
let openId        = null;
let unsubscribe   = null;

// ── AUTH ─────────────────────────────────────────────────────
const loginScreen = document.getElementById('login-screen');
const dashboard   = document.getElementById('dashboard');
const detailPane  = document.getElementById('detail-pane');

auth.onAuthStateChanged(user => {
  document.body.style.visibility = 'visible';
  if (user) {
    loginScreen.hidden = true;
    dashboard.hidden   = false;
    set('user-email', user.email);
    startListener();
  } else {
    loginScreen.hidden = false;
    dashboard.hidden   = true;
    stopListener();
    allDemandes = [];
  }
});

document.getElementById('toggle-pwd')?.addEventListener('click', () => {
  const input = document.getElementById('l-password');
  const icon  = document.getElementById('eye-icon');
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  icon.innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

document.getElementById('login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn        = document.getElementById('login-btn');
  const errEl      = document.getElementById('login-error');
  const email      = document.getElementById('l-email').value.trim();
  const pass       = document.getElementById('l-password').value;
  const rememberMe = document.getElementById('remember-me')?.checked ?? true;

  btn.disabled    = true;
  btn.textContent = 'Connexion…';
  errEl.hidden    = true;

  try {
    await auth.setPersistence(rememberMe ? 'local' : 'session');
    await auth.signInWithEmailAndPassword(email, pass);
  } catch {
    errEl.textContent = 'Email ou mot de passe incorrect.';
    errEl.hidden      = false;
    btn.disabled      = false;
    btn.textContent   = 'Se connecter';
  }
});

document.getElementById('logout-btn')?.addEventListener('click', () => auth.signOut());

// ── LISTENER TEMPS RÉEL ───────────────────────────────────────
function startListener() {
  stopListener();
  const listEl = document.getElementById('requests-list');
  if (listEl) listEl.innerHTML = '<div class="state-msg">Chargement…</div>';

  unsubscribe = db.collection('demandes')
    .orderBy('created_at', 'desc')
    .onSnapshot(snap => {
      allDemandes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStats();
      renderList();
      // Mise à jour légère du panneau ouvert sans réécrire le HTML entier
      // (évite de détruire la carte Leaflet en cours d'initialisation)
      if (openId) {
        const d = allDemandes.find(x => x.id === openId);
        if (d) {
          const metaEl = document.getElementById('detail-meta');
          if (metaEl) metaEl.textContent = `Reçu le ${fmtDate(d.created_at)} · ${statutLabel(d.statut || 'nouveau')}`;
          const sel = document.getElementById('detail-statut');
          if (sel && document.activeElement !== sel) sel.value = d.statut || 'nouveau';
        }
      }
    }, err => {
      console.error('[Firebase] onSnapshot erreur :', err.code, err.message);
      const listEl = document.getElementById('requests-list');
      if (listEl) listEl.innerHTML = `
        <div class="state-msg" style="color:var(--red)">
          ⚠️ Erreur Firestore : <strong>${esc(err.code || err.message)}</strong><br>
          <small>Vérifiez les règles de sécurité dans la Firebase Console.</small>
        </div>`;
    });
}

function stopListener() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

// ── GRILLE TARIFAIRE ─────────────────────────────────────────
const TARIFS_DEFAULTS = {
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

document.getElementById('btn-tarifs')?.addEventListener('click', () => {
  const content = document.querySelector('.admin-content');
  const panel   = document.getElementById('tarifs-panel');
  const btn     = document.getElementById('btn-tarifs');
  const isOpen  = !panel.hidden;
  content.hidden = !isOpen;
  panel.hidden   = isOpen;
  btn.classList.toggle('active', !isOpen);
  if (!isOpen) loadTarifsPanel();
});

async function loadTarifsPanel() {
  const panel = document.getElementById('tarifs-panel');
  panel.innerHTML = '<div class="state-msg">Chargement…</div>';

  let t = JSON.parse(JSON.stringify(TARIFS_DEFAULTS));
  try {
    const snap = await db.collection('config').doc('tarifs').get();
    if (snap.exists) {
      const data = snap.data();
      if (data.hydrocurage?.particulier?.base) t = data;
    }
  } catch (e) { console.error('[Firebase] Tarifs load failed:', e.code, e.message); }

  const CLIENT_TYPES = [
    { key: 'particulier',   icon: '🏠', label: 'Particulier' },
    { key: 'professionnel', icon: '🏢', label: 'Pro' },
    { key: 'collectivite',  icon: '🏛️', label: 'Coll.' },
    { key: 'association',   icon: '🤝', label: 'Asso' },
  ];

  // min–max field row
  // haToM2 : stocké en €/ha, affiché en €/m² (÷10000 à l'affichage, ×10000 à la sauvegarde)
  const base = (field, label, unit, val, haToM2 = false) => {
    const fmt  = v => haToM2 ? ((v ?? 0) / 10000).toFixed(4) : (v ?? 0);
    const step = haToM2 ? '0.0001' : '1';
    const ha   = haToM2 ? ' data-ha2m2="true"' : '';
    return `
    <div class="tg-row">
      <span class="tg-label">${label} <span class="tg-unit">${unit}</span></span>
      <input type="number" class="tg-input" data-field="${field}.min"${ha} value="${fmt(val?.min)}" min="0" step="${step}">
      <span class="tg-sep">–</span>
      <input type="number" class="tg-input" data-field="${field}.max"${ha} value="${fmt(val?.max)}" min="0" step="${step}">
    </div>`;
  };

  // % modifier row (skipped by global coefficient apply)
  const mod = (field, label, val) => `
    <div class="tg-mod">
      <span class="tg-mod-lbl">↳ ${label}</span>
      <input type="number" class="tg-mod-input" data-field="${field}" data-mod="true" value="${val ?? 0}" min="0" max="300" step="1">
      <span class="tg-pct">%</span>
    </div>`;

  // tab section for per-client prices
  const tabs = (svc, contentFn) => `
    <div class="tg-tabs" data-svc="${svc}">
      <div class="tg-tab-lbl">Tarifs par profil client</div>
      <div class="tg-tab-bar">
        ${CLIENT_TYPES.map((c, i) => `<button type="button" class="tg-tab-btn${i === 0 ? ' active' : ''}" data-svc="${svc}" data-client="${c.key}">${c.icon} ${c.label}</button>`).join('')}
      </div>
      ${CLIENT_TYPES.map((c, i) => `
        <div class="tg-tab-pane${i === 0 ? ' active' : ''}" data-svc="${svc}" data-pane="${c.key}">
          ${contentFn(svc, c.key)}
        </div>`).join('')}
    </div>`;

  // helpers to get per-client value safely
  const tc = (svc, client) => (t[svc]?.[client]) ?? (TARIFS_DEFAULTS[svc]?.[client]) ?? {};

  const card = (title, shared, tabsFn) => `
    <div class="tg-card">
      <div class="tg-title">${title}</div>
      ${shared}
      ${tabsFn}
    </div>`;

  panel.innerHTML = `
    <div class="tarifs-panel-header">
      <div>
        <h2>⚙️ Grille tarifaire</h2>
        <p>Mobilisation + modificateurs partagés tous profils · Prix de prestation par profil client.</p>
      </div>
      <button id="btn-tarifs-save" class="btn-tarifs-save">💾 Sauvegarder</button>
    </div>

    <div class="coeff-bar">
      <span class="coeff-label">Ajuster les bases de</span>
      <input type="range" id="coeff-slider" min="-50" max="100" value="0" step="1" class="coeff-slider">
      <span class="coeff-sign" id="coeff-sign">+</span>
      <input type="number" id="coeff-pct" value="0" min="-50" max="100" step="1" class="coeff-input">
      <span class="coeff-unit">%</span>
      <button id="coeff-apply" class="btn-coeff-apply">Appliquer</button>
      <button id="coeff-reset" class="btn-coeff-reset">Réinitialiser</button>
    </div>

    <div class="tarifs-grid">
      ${card('💧 Hydrocurage',
        base('hydrocurage.mobilisation', '🚛 Mobilisation pompe', '€', t.hydrocurage.mobilisation) +
        mod('hydrocurage.moyen',     'Accès moyen',     t.hydrocurage.moyen     ?? 20) +
        mod('hydrocurage.difficile', 'Accès difficile', t.hydrocurage.difficile ?? 40),
        tabs('hydrocurage', (svc, cl) =>
          base(`${svc}.${cl}.base`,       'Prestation',       '€/m³', tc(svc,cl).base) +
          base(`${svc}.${cl}.evacuation`, 'Suppl. évacuation','€/m³', tc(svc,cl).evacuation)
        )
      )}
      ${card('🚜 Curage mécanique',
        base('curage.mobilisation', '🚛 Mobilisation drague', '€', t.curage.mobilisation) +
        mod('curage.moyen',     'Accès moyen',     t.curage.moyen     ?? 20) +
        mod('curage.difficile', 'Accès difficile', t.curage.difficile ?? 40),
        tabs('curage', (svc, cl) =>
          base(`${svc}.${cl}.base`,       'Prestation',       '€/m³', tc(svc,cl).base) +
          base(`${svc}.${cl}.evacuation`, 'Suppl. évacuation','€/m³', tc(svc,cl).evacuation)
        )
      )}
      ${card('🌿 Faucardage',
        base('faucardage.mobilisation', '🚛 Mobilisation bateau', '€', t.faucardage.mobilisation) +
        mod('faucardage.moyen',     'Accès moyen',     t.faucardage.moyen     ?? 20) +
        mod('faucardage.difficile', 'Accès difficile', t.faucardage.difficile ?? 40) +
        mod('faucardage.jussie',    'Jussie',          t.faucardage.jussie    ?? 40),
        tabs('faucardage', (svc, cl) =>
          base(`${svc}.${cl}.base`, 'Prestation', '€/m²', tc(svc,cl).base, true)
        )
      )}
      ${card('🪨 Défenses de berges',
        base('berges.mobilisation', '🚛 Mobilisation pelle', '€', t.berges.mobilisation),
        tabs('berges', (svc, cl) =>
          base(`${svc}.${cl}.enrochement`, 'Enrochement',   '€/ml', tc(svc,cl).enrochement) +
          base(`${svc}.${cl}.palplanche`,  'Palplanches',   '€/ml', tc(svc,cl).palplanche)  +
          base(`${svc}.${cl}.gabion`,      'Gabions',       '€/ml', tc(svc,cl).gabion)      +
          base(`${svc}.${cl}.vegetal`,     'Génie végétal', '€/ml', tc(svc,cl).vegetal)     +
          base(`${svc}.${cl}.conseil`,     'À définir',     '€/ml', tc(svc,cl).conseil)
        )
      )}
      ${card('🌲 Broyage forestier',
        base('broyage-forestier.mobilisation', '🚛 Mobilisation broyeur', '€', t['broyage-forestier'].mobilisation),
        tabs('broyage-forestier', (svc, cl) =>
          base(`${svc}.${cl}.legere`,  'Végétation légère', '€/m²', tc(svc,cl).legere,  true) +
          base(`${svc}.${cl}.moyenne`, 'Végétation moyenne','€/m²', tc(svc,cl).moyenne, true) +
          base(`${svc}.${cl}.dense`,   'Végétation dense',  '€/m²', tc(svc,cl).dense,   true)
        )
      )}
      ${card('🌾 Broyage roseaux',
        base('broyage-roseaux.mobilisation', '🚛 Mobilisation bateau', '€', t['broyage-roseaux'].mobilisation) +
        mod('broyage-roseaux.ramassage', 'Avec ramassage',  t['broyage-roseaux'].ramassage ?? 80) +
        mod('broyage-roseaux.moyen',     'Accès moyen',     t['broyage-roseaux'].moyen     ?? 30) +
        mod('broyage-roseaux.difficile', 'Accès difficile', t['broyage-roseaux'].difficile ?? 60),
        tabs('broyage-roseaux', (svc, cl) =>
          base(`${svc}.${cl}.base`, 'Prestation', '€/m²', tc(svc,cl).base, true)
        )
      )}
    </div>
    <div id="tarifs-status" class="tarifs-status" style="margin-top:.75rem"></div>`;

  document.getElementById('btn-tarifs-save')?.addEventListener('click', saveTarifs);

  // Tab switching
  panel.querySelectorAll('.tg-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const svc    = btn.dataset.svc;
      const client = btn.dataset.client;
      const tabsEl = panel.querySelector(`.tg-tabs[data-svc="${svc}"]`);
      if (!tabsEl) return;
      tabsEl.querySelectorAll('.tg-tab-btn').forEach(b => b.classList.remove('active'));
      tabsEl.querySelectorAll('.tg-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      tabsEl.querySelector(`.tg-tab-pane[data-pane="${client}"]`)?.classList.add('active');
    });
  });

  const slider   = document.getElementById('coeff-slider');
  const pctInput = document.getElementById('coeff-pct');
  const sign     = document.getElementById('coeff-sign');
  function updateSign(v) { sign.textContent = v >= 0 ? '+' : ''; sign.style.color = v < 0 ? 'var(--red)' : 'var(--green-600)'; }
  slider?.addEventListener('input',  () => { pctInput.value = slider.value;  updateSign(+slider.value); });
  pctInput?.addEventListener('input', () => { slider.value  = pctInput.value; updateSign(+pctInput.value); });

  document.getElementById('coeff-apply')?.addEventListener('click', () => {
    const factor = 1 + (parseFloat(pctInput.value) || 0) / 100;
    panel.querySelectorAll('.tg-input[data-field]').forEach(input => {
      const newVal = (parseFloat(input.value) || 0) * factor;
      input.value = input.dataset.ha2m2 === 'true'
        ? newVal.toFixed(4)
        : Math.round(newVal);
    });
  });

  document.getElementById('coeff-reset')?.addEventListener('click', () => {
    slider.value = 0; pctInput.value = 0; updateSign(0);
    panel.querySelectorAll('[data-field]').forEach(input => {
      const keys = input.dataset.field.split('.');
      let obj = TARIFS_DEFAULTS;
      try {
        for (const k of keys) obj = obj[k];
        input.value = input.dataset.ha2m2 === 'true' ? (obj / 10000).toFixed(4) : obj;
      } catch {}
    });
  });
}

async function saveTarifs() {
  const tarifs = JSON.parse(JSON.stringify(TARIFS_DEFAULTS));
  const panel  = document.getElementById('tarifs-panel');

  panel.querySelectorAll('[data-field]').forEach(input => {
    const keys  = input.dataset.field.split('.');
    const raw   = parseFloat(input.value) || 0;
    const value = input.dataset.ha2m2 === 'true' ? raw * 10000 : raw;
    let obj = tarifs;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  });

  const btn    = document.getElementById('btn-tarifs-save');
  const status = document.getElementById('tarifs-status');
  btn.disabled    = true;
  btn.textContent = 'Sauvegarde…';
  status.className = 'tarifs-status';
  status.textContent = '';

  try {
    await db.collection('config').doc('tarifs').set(tarifs);
    status.textContent = '✓ Tarifs sauvegardés. Ils s\'appliquent aux nouvelles estimations immédiatement.';
  } catch (err) {
    status.className   = 'tarifs-status err';
    status.textContent = 'Erreur : ' + err.message;
  }

  btn.disabled    = false;
  btn.textContent = '💾 Sauvegarder';
}

// ── STATS ────────────────────────────────────────────────────
function renderStats() {
  const active = allDemandes.filter(d => !d.archived);
  set('stat-total',   active.length);
  set('stat-nouveau', active.filter(d => (d.statut || 'nouveau') === 'nouveau').length);  // uniquement jamais vus
  set('stat-encours', active.filter(d => ['contacte', 'devis_envoye'].includes(d.statut)).length);
  set('stat-gagne',   active.filter(d => d.statut === 'chantier_gagne').length);
}

// ── FILTRES ──────────────────────────────────────────────────
document.querySelectorAll('.fnav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fnav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.status;
    renderList();
  });
});

document.getElementById('search-input')?.addEventListener('input', e => {
  currentSearch = e.target.value.toLowerCase().trim();
  renderList();
});

document.getElementById('sort-select')?.addEventListener('change', e => {
  currentSort = e.target.value;
  renderList();
});

// ── LISTE ────────────────────────────────────────────────────
function renderList() {
  const listEl = document.getElementById('requests-list');
  if (!listEl) return;

  let items = [...allDemandes];
  if (currentFilter === 'archived') {
    items = items.filter(d => d.archived === true);
  } else {
    items = items.filter(d => !d.archived);
    if (currentFilter !== 'all') items = items.filter(d => (d.statut || 'nouveau') === currentFilter);
  }
  if (currentSearch) {
    items = items.filter(d => {
      const hay = [d.prenom, d.nom, d.email, d.telephone, d.adresse, d.message].join(' ').toLowerCase();
      return hay.includes(currentSearch);
    });
  }
  if (currentSort === 'asc') items = items.slice().reverse();

  if (!items.length) {
    listEl.innerHTML = '<div class="state-msg">Aucune demande trouvée.</div>';
    return;
  }

  listEl.innerHTML = items.map(renderCard).join('');
  listEl.querySelectorAll('.req-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function renderCard(d) {
  const statut    = d.statut || 'nouveau';
  const isContact = d.type === 'contact';
  const isActive  = d.id === openId;

  const name = isContact
    ? esc(d.nom || '–')
    : `${esc(d.prenom || '')} ${esc(d.nom || '')}`.trim() || '–';

  const tags = isContact
    ? `<span class="ctag ctag-contact">💬 Contact</span>`
    : (d.travaux || []).map(t => `<span class="ctag">${travailShort(t)}</span>`).join('');

  const preview = isContact && d.message
    ? `<div class="card-preview">${esc(d.message)}</div>`
    : '';

  const metric = !isContact ? cardMetric(d) : '';

  const distKm = !isContact && d.lat && d.lng
    ? Math.round(haversineKm(DEPOT_LAT, DEPOT_LNG, d.lat, d.lng))
    : null;

  return `
    <div class="req-card s-${statut}${isActive ? ' is-active' : ''}" data-id="${esc(d.id)}">
      <div class="card-main">
        <div class="card-name">${name}</div>
        <div class="card-addr">${esc(d.email || '–')}</div>
        <div class="card-tags">${tags}</div>
        ${metric ? `<div class="card-metric">${esc(metric)}</div>` : ''}
        ${preview}
      </div>
      <div class="card-right">
        <div class="card-badge"><span class="badge b-${statut}">${statutLabel(statut)}</span></div>
        ${distKm !== null ? `<div class="card-dist">📍 ${distKm} km</div>` : ''}
        <div class="card-date">${fmtRelative(d.created_at)}</div>
        ${!isContact && d.estimation_text ? `<div class="card-amount">${esc(d.estimation_text)}</div>` : ''}
      </div>
    </div>`;
}

// ── DETAIL PANE ───────────────────────────────────────────────
function openDetail(id) {
  const d = allDemandes.find(x => x.id === id);
  if (!d) return;
  openId = id;
  document.querySelectorAll('.req-card').forEach(c => c.classList.toggle('is-active', c.dataset.id === id));
  renderDetailPane(d);
  // Passage automatique nouveau → a_traiter à la première ouverture
  if ((d.statut || 'nouveau') === 'nouveau') {
    db.collection('demandes').doc(id).update({
      statut: 'a_traiter',
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error('Statut update failed:', err));
  }
}

function renderDetailPane(d) {
  const statut    = d.statut || 'nouveau';
  const isContact = d.type === 'contact';
  const name      = isContact
    ? esc(d.nom || '–')
    : `${esc(d.prenom || '')} ${esc(d.nom || '')}`.trim() || '–';

  let contentHtml = '';

  if (isContact) {
    contentHtml = `
      <div class="dsec">
        <h3>Coordonnées</h3>
        <div class="info-grid">
          <div>
            <div class="info-label">Nom</div>
            <div class="info-value">${esc(d.nom || '–')}</div>
          </div>
          <div>
            <div class="info-label">Email</div>
            <div class="info-value"><a href="mailto:${esc(d.email || '')}">${esc(d.email || '–')}</a></div>
          </div>
          <div>
            <div class="info-label">Téléphone</div>
            <div class="info-value">${d.telephone ? `<a href="tel:${esc(d.telephone)}">${esc(d.telephone)}</a>` : '–'}</div>
          </div>
        </div>
      </div>
      <div class="dsec">
        <h3>Message</h3>
        ${d.message
          ? `<p style="font-size:.88rem;color:var(--gray-700);line-height:1.75;white-space:pre-wrap;">${esc(d.message)}</p>`
          : `<p style="color:var(--gray-400);font-size:.85rem;font-style:italic;">Aucun message.</p>`}
      </div>`;

  } else {
    const travaux = d.travaux || [];
    const details = d.details || {};

    const profilMap = { particulier:'Particulier', association:'Association', collectivite:'Collectivité', agriculteur:'Agriculteur', autre:'Autre' };
    const delaiMap  = { urgent:'Urgent – dès que possible', '3mois':'Dans 3 mois', '6mois':'Dans 6 mois', '1an':'Dans l\'année', indefini:'Non défini' };
    const accesMap  = { facile:'Facile', moyen:'Moyen', difficile:'Difficile' };
    const destMap   = { 'sur-place':'Épandage sur place', evacuation:'Évacuation par nos soins', valorisation:'Valorisation agricole' };
    const typeMap   = { enrochement:'Enrochement', palplanche:'Palplanches', gabion:'Gabions', vegetal:'Génie végétal', conseil:'À définir' };
    const densMap   = { legere:'Légère', moyenne:'Moyenne', dense:'Dense' };

    let detailRows = '';
    if (details.hydrocurage)
      detailRows += drow('Hydrocurage', `Épaisseur : ${details.hydrocurage.epaisseur_cm ?? '–'} cm · Volume : ${details.hydrocurage.volume_m3 ?? details.hydrocurage.longueur_ml ?? '–'} m³`);
    if (details.curage) {
      detailRows += drow('Curage – prof. vase', `${details.curage.prof_vase_cm} cm`);
      detailRows += drow('Curage – surface concernée', `${details.curage.pct_surface} %`);
      detailRows += drow('Destination de la vase', destMap[details.curage.destination_vase] || details.curage.destination_vase);
    }
    if (details.faucardage) {
      detailRows += drow('Faucardage – couverture', `${details.faucardage.pct_couverture} %`);
      if (details.faucardage.jussie) detailRows += drow('Jussie (invasive)', 'Oui (+40 %)');
    }
    if (details.berges) {
      detailRows += drow('Berges – longueur', `${details.berges.longueur_ml} ml`);
      detailRows += drow('Type de protection', typeMap[details.berges.type] || details.berges.type);
    }
    if (details['broyage-forestier']) {
      detailRows += drow('Broyage forestier', `${details['broyage-forestier'].surface_ha} ha`);
      detailRows += drow('Densité végétation', densMap[details['broyage-forestier'].densite] || details['broyage-forestier'].densite);
    }
    if (details['broyage-roseaux']) {
      detailRows += drow('Broyage roseaux', `${details['broyage-roseaux'].surface_ha} ha`);
      detailRows += drow('Avec ramassage', details['broyage-roseaux'].avec_ramassage ? 'Oui' : 'Non');
    }

    contentHtml = `
      ${details.demandeAccompagnement ? `
      <div class="adm-accomp-banner">
        <strong>✋ Accompagnement administratif demandé</strong>
        Le client souhaite que Vandaele prenne en charge les démarches (Loi sur l'eau, Natura 2000, dossier préfectoral…).
      </div>` : ''}

      <div class="dsec">
        <h3>Contact</h3>
        <div class="info-grid">
          <div>
            <div class="info-label">Prénom / Nom</div>
            <div class="info-value">${esc(d.prenom || '')} ${esc(d.nom || '')}</div>
          </div>
          <div>
            <div class="info-label">Email</div>
            <div class="info-value"><a href="mailto:${esc(d.email || '')}">${esc(d.email || '–')}</a></div>
          </div>
          <div>
            <div class="info-label">Téléphone</div>
            <div class="info-value">${d.telephone ? `<a href="tel:${esc(d.telephone)}">${esc(d.telephone)}</a>` : '–'}</div>
          </div>
          <div>
            <div class="info-label">Profil</div>
            <div class="info-value">${esc(profilMap[d.profil] || d.profil || '–')}</div>
          </div>
          <div>
            <div class="info-label">Délai envisagé</div>
            <div class="info-value">${esc(delaiMap[d.delai] || d.delai || '–')}</div>
          </div>
          ${details.typeClient ? `<div>
            <div class="info-label">Type client (tarification)</div>
            <div class="info-value">${esc({ particulier:'Particulier', professionnel:'Professionnel', collectivite:'Collectivité', association:'Association' }[details.typeClient] || details.typeClient)}</div>
          </div>` : ''}
        </div>
      </div>

      <div class="dsec">
        <h3>Chantier ${d.lat && d.lng
          ? `<span class="dist-badge">📍 ${Math.round(haversineKm(DEPOT_LAT, DEPOT_LNG, d.lat, d.lng))} km du dépôt</span>`
          : ''}</h3>
        ${d.adresse ? `<div style="margin-bottom:.65rem"><div class="info-label">Adresse</div><div class="info-value">${esc(d.adresse)}</div></div>` : ''}
        <div class="info-grid">
          ${d.surface_ha   ? `<div><div class="info-label">Surface</div><div class="info-value">${fmtSurface(d.surface_ha)}</div></div>` : ''}
          ${d.perimetre_ml ? `<div><div class="info-label">Périmètre</div><div class="info-value">${d.perimetre_ml} ml</div></div>` : ''}
          ${d.acces ? `<div><div class="info-label">Accès</div><div class="info-value">${esc(accesMap[d.acces] || d.acces)}</div></div>` : ''}
          ${(() => { const m = cardMetric(d); return m ? `<div style="grid-column:1/-1"><div class="info-label">Volume / Dimensions</div><div class="info-value" style="font-size:.95rem;font-weight:700;color:var(--green-600)">${esc(m)}</div></div>` : ''; })()}
        </div>
        ${travaux.length ? `
        <div style="margin-top:.7rem">
          <div class="info-label" style="margin-bottom:.35rem">Travaux demandés</div>
          <div class="work-chips">${travaux.map(t => `<span class="work-chip">${travailLabel(t)}</span>`).join('')}</div>
        </div>` : ''}
        ${(d.geojson || (d.lat && d.lng)) ? `<div id="admin-map" style="height:220px;margin-top:.9rem;border-radius:8px;overflow:hidden;background:var(--gray-200);"></div>` : ''}
      </div>

      ${detailRows ? `
      <div class="dsec">
        <h3>Paramètres des travaux</h3>
        ${detailRows}
      </div>` : ''}

      ${d.infos_sup ? `
      <div class="dsec">
        <h3>Informations complémentaires</h3>
        <p style="font-size:.85rem;color:var(--gray-700);line-height:1.6;white-space:pre-wrap;">${esc(d.infos_sup)}</p>
      </div>` : ''}

      ${d.lat && d.lng ? `
      <div class="dsec" id="dsec-zones">
        <h3>Zones environnementales &amp; démarches</h3>
        ${details.demandeAccompagnement ? '<div class="adm-accomp-badge">✋ Accompagnement administratif demandé par le client</div>' : ''}
        <div id="admin-zones-content"><div class="adm-zones-loading">🔍 Vérification en cours…</div></div>
      </div>` : ''}

      <div class="est-total">
        <div class="est-total-label">Estimation indicative</div>
        <div class="est-total-val">${esc(d.estimation_text || '–')}</div>
      </div>`;
  }

  detailPane.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${name}</h2>
        <div class="detail-meta" id="detail-meta">Reçu le ${fmtDate(d.created_at)} · ${statutLabel(statut)}</div>
      </div>
      <div style="display:flex;gap:.5rem;flex-shrink:0;">
        ${d.archived
          ? `<button class="btn-unarchive" id="btn-archive-toggle">↩ Désarchiver</button>`
          : `<button class="btn-archive" id="btn-archive-toggle">📦 Archiver</button>`}
        <button class="btn-delete" id="btn-delete" title="Supprimer cette demande">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
          Supprimer
        </button>
      </div>
    </div>
    <div class="detail-scroll">
      ${contentHtml}
      <div class="admin-sec">
        <h3>Suivi</h3>
        <select class="statut-sel" id="detail-statut">
          <option value="nouveau"        ${statut==='nouveau'        ?'selected':''}>🔴 Non lu</option>
          <option value="a_traiter"      ${statut==='a_traiter'      ?'selected':''}>🟠 À traiter</option>
          <option value="contacte"       ${statut==='contacte'       ?'selected':''}>🟡 Contacté</option>
          <option value="devis_envoye"   ${statut==='devis_envoye'   ?'selected':''}>🔵 Devis envoyé</option>
          <option value="chantier_gagne" ${statut==='chantier_gagne' ?'selected':''}>🟢 Chantier gagné</option>
          <option value="sans_suite"     ${statut==='sans_suite'     ?'selected':''}>⚫ Sans suite</option>
        </select>
        <div class="note-lbl">Note interne</div>
        <textarea class="note-ta" id="detail-note" placeholder="Ajouter une note…">${esc(d.note_admin || '')}</textarea>
        <div class="note-saved" id="note-saved"></div>
      </div>
    </div>`;

  document.getElementById('btn-archive-toggle')?.addEventListener('click', () =>
    d.archived ? unarchiveDetail(d.id) : archiveDetail(d.id)
  );
  document.getElementById('btn-delete')?.addEventListener('click', () => deleteDetail(d.id, name));

  document.getElementById('detail-statut')?.addEventListener('change', async e => {
    const newStatut = e.target.value;
    try {
      await db.collection('demandes').doc(d.id).update({
        statut: newStatut,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
      const metaEl = document.getElementById('detail-meta');
      if (metaEl) metaEl.textContent = `Reçu le ${fmtDate(d.created_at)} · ${statutLabel(newStatut)}`;
    } catch (err) {
      console.error('Update statut failed:', err);
    }
  });

  let noteSaveTimer = null;
  document.getElementById('detail-note')?.addEventListener('input', () => {
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(async () => {
      const note = document.getElementById('detail-note')?.value || '';
      try {
        await db.collection('demandes').doc(d.id).update({
          note_admin: note,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        const el = document.getElementById('note-saved');
        if (el) { el.textContent = '✓ Sauvegardé'; el.style.opacity = '1'; setTimeout(() => { if (el) el.style.opacity = '0'; }, 2000); }
      } catch (err) {
        console.error('Update note failed:', err);
      }
    }, 800);
  });

  if (!isContact && d.lat && d.lng) checkAdminZones(d.lat, d.lng, d);

  // Carte du tracé client — setTimeout pour laisser le navigateur calculer le layout
  if (d.geojson || (d.lat && d.lng)) {
    let geojson = null;
    try {
      geojson = d.geojson
        ? (typeof d.geojson === 'string' ? JSON.parse(d.geojson) : d.geojson)
        : null;
    } catch (e) { console.error('GeoJSON parse error:', e); }
    loadLeaflet(() => setTimeout(() => renderAdminMap(geojson, d.lat, d.lng), 80));
  }
}

function loadLeaflet(cb) {
  if (window.L) { cb(); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  script.onload = cb;
  document.head.appendChild(script);
}

function renderAdminMap(geojson, lat, lng) {
  const el = document.getElementById('admin-map');
  if (!el) return;
  try {
    if (adminMap) { adminMap.remove(); adminMap = null; }
    adminMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
    L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
      '&FORMAT=image%2Fjpeg&STYLE=normal',
      { attribution: '© IGN', maxZoom: 21, maxNativeZoom: 19 }
    ).addTo(adminMap);

    // invalidateSize d'abord pour que le conteneur ait ses bonnes dimensions
    adminMap.invalidateSize();

    if (geojson) {
      const layer = L.geoJSON(geojson, {
        style: { color: '#3d9e62', weight: 2.5, fillColor: '#56b57a', fillOpacity: 0.2 }
      }).addTo(adminMap);
      try { adminMap.fitBounds(layer.getBounds(), { padding: [24, 24] }); } catch(e) {}
    } else if (lat && lng) {
      adminMap.setView([lat, lng], 15);
      L.marker([lat, lng]).addTo(adminMap);
    }

    // Second passage après rendu complet
    setTimeout(() => { if (adminMap) adminMap.invalidateSize(); }, 300);
  } catch (err) {
    console.error('Map render error:', err);
  }
}

// ── ROUTE MODAL ──────────────────────────────────────────────
detailPane.addEventListener('click', e => {
  const badge = e.target.closest('.dist-badge');
  if (!badge) return;
  const d = allDemandes.find(x => x.id === openId);
  if (!d?.lat || !d?.lng) return;
  showRouteModal(d.lat, d.lng);
});

document.getElementById('route-modal-close')?.addEventListener('click', closeRouteModal);
document.getElementById('route-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('route-modal')) closeRouteModal();
});

function closeRouteModal() {
  document.getElementById('route-modal').hidden = true;
  if (routeMap) { routeMap.remove(); routeMap = null; }
}

function showRouteModal(lat, lng) {
  const modal = document.getElementById('route-modal');
  const meta  = document.getElementById('route-modal-meta');
  const gmaps = document.getElementById('route-gmaps-link');

  meta.textContent = 'Calcul de l\'itinéraire…';
  gmaps.href = `https://www.google.com/maps/dir/${DEPOT_LAT},${DEPOT_LNG}/${lat},${lng}`;
  modal.hidden = false;

  loadLeaflet(() => setTimeout(() => {
    const el = document.getElementById('route-map');
    if (!el) return;
    if (routeMap) { routeMap.remove(); routeMap = null; }

    routeMap = L.map(el, { zoomControl: true, scrollWheelZoom: true, attributionControl: false });
    L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
      '&FORMAT=image%2Fpng&STYLE=normal',
      { attribution: '© IGN', maxZoom: 19 }
    ).addTo(routeMap);

    const depotIcon    = L.divIcon({ html: '<div style="font-size:1.3rem;line-height:1">🏠</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
    const chantierIcon = L.divIcon({ html: '<div style="font-size:1.3rem;line-height:1">📍</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 24] });
    L.marker([DEPOT_LAT, DEPOT_LNG], { icon: depotIcon }).bindPopup('<strong>Dépôt</strong><br>Tortefontaine').addTo(routeMap);
    L.marker([lat, lng], { icon: chantierIcon }).bindPopup('<strong>Chantier</strong>').addTo(routeMap);

    routeMap.fitBounds([[DEPOT_LAT, DEPOT_LNG], [lat, lng]], { padding: [48, 48] });
    routeMap.invalidateSize();

    // Route via OSRM (free, pas de clé API requise)
    const url = `https://router.project-osrm.org/route/v1/driving/${DEPOT_LNG},${DEPOT_LAT};${lng},${lat}?overview=full&geometries=geojson`;
    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(r => r.json())
      .then(data => {
        const route = data.routes?.[0];
        if (!route) { meta.textContent = `~${Math.round(haversineKm(DEPOT_LAT, DEPOT_LNG, lat, lng))} km (vol d'oiseau)`; return; }
        const km   = (route.distance / 1000).toFixed(1);
        const mins = Math.round(route.duration / 60);
        const h = Math.floor(mins / 60), m = mins % 60;
        const t = h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${mins} min`;
        meta.innerHTML = `<strong>${km} km</strong> &nbsp;·&nbsp; ${t} de trajet estimé`;
        const line = L.geoJSON(route.geometry, { style: { color: '#1d4ed8', weight: 4, opacity: .8 } }).addTo(routeMap);
        routeMap.fitBounds(line.getBounds(), { padding: [48, 48] });
      })
      .catch(() => {
        meta.textContent = `~${Math.round(haversineKm(DEPOT_LAT, DEPOT_LNG, lat, lng))} km (vol d'oiseau — routage indisponible)`;
      });
  }, 60));
}

async function archiveDetail(id) {
  try {
    await db.collection('demandes').doc(id).update({
      archived: true,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    openId = null;
    if (adminMap) { adminMap.remove(); adminMap = null; }
    detailPane.innerHTML = `
      <div class="detail-empty">
        <div class="detail-empty-icon">📦</div>
        <p>Demande archivée.<br><small>Retrouvez-la dans le filtre "Archivées".</small></p>
      </div>`;
  } catch (err) {
    console.error('Archive failed:', err);
  }
}

async function unarchiveDetail(id) {
  try {
    await db.collection('demandes').doc(id).update({
      archived: false,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Unarchive failed:', err);
  }
}

async function deleteDetail(id, name) {
  if (!confirm(`Supprimer la demande de ${name} ?\n\nCette action est irréversible.`)) return;
  try {
    await db.collection('demandes').doc(id).delete();
    openId = null;
    if (adminMap) { adminMap.remove(); adminMap = null; }
    detailPane.innerHTML = `
      <div class="detail-empty">
        <div class="detail-empty-icon">🗑️</div>
        <p>Demande supprimée.</p>
      </div>`;
  } catch (err) {
    alert('Erreur lors de la suppression. Vérifiez les règles Firestore.');
    console.error(err);
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cardMetric(d) {
  const details = d.details || {};
  const parts   = [];
  if (d.surface_ha)   parts.push(fmtSurface(d.surface_ha));
  if (d.perimetre_ml) parts.push(`${d.perimetre_ml} ml`);
  if (details.curage && d.surface_ha) {
    const vol = Math.round(d.surface_ha * 10000 * (details.curage.pct_surface / 100) * (details.curage.prof_vase_cm / 100));
    if (vol > 0) parts.push(`≈ ${vol.toLocaleString('fr')} m³`);
  }
  if (details.hydrocurage) {
    const vol = details.hydrocurage.volume_m3 ?? details.hydrocurage.longueur_ml;
    if (vol) parts.push(`${vol} m³ hydro.`);
  }
  if (details.berges && !d.perimetre_ml)    parts.push(`${details.berges.longueur_ml} ml berges`);
  return parts.join(' · ');
}

function drow(key, val) {
  return `<div class="drow"><span class="dk">${esc(key)}</span><span class="dv">${esc(String(val))}</span></div>`;
}

function fmtSurface(ha) {
  const m2 = Math.round(parseFloat(ha) * 10000);
  if (m2 < 10000) return `${m2.toLocaleString('fr')} m²`;
  return `${parseFloat(ha).toLocaleString('fr', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ha`;
}

// ── UTILS ────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return '–';
  return d.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtRelative(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'À l\'instant';
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7)  return `Il y a ${days}j`;
  if (days < 30) return `Il y a ${Math.floor(days/7)} sem.`;
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
}

function statutLabel(s) {
  return { nouveau:'Non lu', a_traiter:'À traiter', contacte:'Contacté', devis_envoye:'Devis envoyé', chantier_gagne:'Gagné', sans_suite:'Sans suite' }[s] || s;
}

function travailLabel(t) {
  return { hydrocurage:'💧 Hydrocurage', curage:'🚜 Curage mécanique', faucardage:'🌿 Faucardage', berges:'🪨 Défenses de berges', 'broyage-forestier':'🌲 Broyage forestier', 'broyage-roseaux':'🌾 Broyage roseaux', diagnostic:'🔍 Diagnostic' }[t] || t;
}

function travailShort(t) {
  return { hydrocurage:'💧 Hydro.', curage:'🚜 Curage', faucardage:'🌿 Fauc.', berges:'🪨 Berges', 'broyage-forestier':'🌲 Broyage', 'broyage-roseaux':'🌾 Roseaux', diagnostic:'🔍 Diag.' }[t] || t;
}

// ── ZONES ENVIRONNEMENTALES (panneau détail admin) ────────────
async function checkAdminZones(lat, lng, d) {
  const container = document.getElementById('admin-zones-content');
  if (!container) return;

  const geom  = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lng, lat] }));
  const base  = 'https://apicarto.ign.fr/api/nature/';
  const checks = [
    { url: `${base}zone-humide?geom=${geom}`,    name: 'Zone humide (Loi sur l\'eau)',     icon: '💧', type: 'zh'  },
    { url: `${base}natura-habitat?geom=${geom}`, name: 'Natura 2000 – Habitats (ZSC/SIC)', icon: '🐸', type: 'nat' },
    { url: `${base}natura-oiseaux?geom=${geom}`, name: 'Natura 2000 – Oiseaux (ZPS)',      icon: '🦅', type: 'nat' },
    { url: `${base}znieff1?geom=${geom}`,        name: 'ZNIEFF de type I',                 icon: '🌿', type: 'zni' },
    { url: `${base}znieff2?geom=${geom}`,        name: 'ZNIEFF de type II',                icon: '🌿', type: 'zni' },
  ];

  const found = [];
  let   errors = 0;

  await Promise.allSettled(checks.map(async c => {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 9000);
      const res  = await fetch(c.url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) { errors++; return; }
      const data = await res.json();
      if (data.features?.length > 0) {
        const p = data.features[0].properties;
        const siteName = p?.sitename || p?.nom_site || p?.nom_zone || p?.nom || p?.code_zh || p?.lb_zh || p?.type_zh || '';
        found.push({ ...c, siteName });
      }
    } catch { errors++; }
  }));

  if (!document.getElementById('admin-zones-content')) return;

  const details       = d.details || {};
  const demandeAccomp = !!details.demandeAccompagnement;
  const surfaceHa     = d.surface_ha || null;

  if (found.length === 0 && errors === checks.length) {
    container.innerHTML = '<p class="adm-zone-indispo">⚠️ Service IGN indisponible – vérification manuelle requise.</p>';
    return;
  }
  if (found.length === 0) {
    container.innerHTML = '<p class="adm-zone-ok">✅ Aucune zone protégée détectée à cette localisation.</p>';
    return;
  }

  const zhFound  = found.filter(z => z.type === 'zh');
  const natFound = found.filter(z => z.type === 'nat');
  const zniFound = found.filter(z => z.type === 'zni');

  let html = '<div class="adm-zone-tags">';
  zhFound.forEach (z => { html += `<span class="adm-ztag adm-ztag-zh">${z.icon} Zone humide${z.siteName ? ` — ${esc(z.siteName)}` : ''}</span>`; });
  natFound.forEach(z => { html += `<span class="adm-ztag adm-ztag-eco">${z.icon} ${esc(z.name)}${z.siteName ? ` — ${esc(z.siteName)}` : ''}</span>`; });
  zniFound.forEach(z => { html += `<span class="adm-ztag adm-ztag-eco">${z.icon} ${esc(z.name)}${z.siteName ? ` — ${esc(z.siteName)}` : ''}</span>`; });
  html += '</div>';

  html += buildDemarchesHtml(zhFound, natFound, zniFound, demandeAccomp, surfaceHa);
  container.innerHTML = html;
}

function buildDemarchesHtml(zhFound, natFound, zniFound, demandeAccomp, surfaceHa) {
  if (!zhFound.length && !natFound.length && !zniFound.length) return '';
  const sh = parseFloat(surfaceHa) || null;

  // Helpers abbr pour éviter la répétition
  const A = {
    IOTA:   `<abbr title="Installations, Ouvrages, Travaux et Activités">IOTA</abbr>`,
    DREAL:  `<abbr title="Direction Régionale de l'Environnement, de l'Aménagement et du Logement">DREAL</abbr>`,
    DDT:    `<abbr title="Direction Départementale des Territoires">DDT</abbr>`,
    DDTM:   `<abbr title="Direction Départementale des Territoires et de la Mer">DDT(M)</abbr>`,
    ERC:    `<abbr title="Éviter, Réduire, Compenser">ERC</abbr>`,
    EIN:    `<abbr title="Évaluation des Incidences Natura 2000">EIN</abbr>`,
    ZSC:    `<abbr title="Zone Spéciale de Conservation">ZSC</abbr>`,
    SIC:    `<abbr title="Site d'Importance Communautaire">SIC</abbr>`,
    ZPS:    `<abbr title="Zone de Protection Spéciale">ZPS</abbr>`,
    FSD:    `<abbr title="Formulaire Standard de Données Natura 2000">FSD</abbr>`,
    ZNIEFF: `<abbr title="Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique">ZNIEFF</abbr>`,
  };

  let html = '<div class="adm-demarches"><div class="adm-demarches-title">Démarches à anticiper</div>';

  // ── ZONE HUMIDE / LOI SUR L\'EAU ───────────────────────────
  if (zhFound.length) {
    const s0 = sh !== null && sh < 0.1;
    const s1 = sh !== null && sh >= 0.1 && sh < 1;
    const s2 = sh !== null && sh >= 1;
    const lvl = s2 ? 'Autorisation' : s1 ? 'Déclaration' : 'À évaluer';
    html += `
    <div class="adm-demarche-card adm-dc-zh">
      <div class="adm-dc-header">
        <span class="adm-dc-icon">💧</span>
        <div>
          <div class="adm-dc-title">Loi sur l'eau — Procédure ${A.IOTA}</div>
          <div class="adm-dc-subtitle">Rubrique 3.3.1.0 — Zones humides (art. L.214-1 C. env.)</div>
        </div>
        <span class="adm-dc-level adm-dc-lv-zh">${lvl}</span>
      </div>
      <div class="adm-dc-body">
        <div class="adm-dc-seuils">
          <div class="adm-dc-seuil${s0 ? ' adm-dc-seuil-ok' : ''}">&#60; 0,1 ha — Pas d'obligation ${A.IOTA} zone humide${s0 ? ' ✓ surface estimée' : ''}</div>
          <div class="adm-dc-seuil${s1 ? ' adm-dc-seuil-warn' : ''}">0,1 – 1 ha — Déclaration à la ${A.DDTM}${s1 ? ' ← surface estimée' : ''}</div>
          <div class="adm-dc-seuil${s2 ? ' adm-dc-seuil-danger' : ''}">&#62; 1 ha — Autorisation préfectorale${s2 ? ' ← surface estimée' : ''}</div>
        </div>
        <div class="adm-dc-steps">
          <div class="adm-dc-step"><span class="adm-dc-step-num">1</span><div>
            <strong>Délimitation réglementaire de la zone humide</strong>
            <p>Relevé pédologique + floristique selon arrêté du 24/06/2008. Confier à un bureau d'études hydraulique (ARTELIA, EGIS, ou cabinet local agréé).</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">2</span><div>
            <strong>Constitution du dossier ${s2 ? 'd\'autorisation' : 'de déclaration'}</strong>
            <p>${s2
              ? `Dossier complet : notice d'incidence, cartographies, mesures ${A.ERC} (Éviter / Réduire / Compenser), mesures compensatoires éventuelles. Enquête publique possible.`
              : `Formulaire Cerfa n° 13617* + notice d'incidence simplifiée avec description du projet, état initial et mesures d'atténuation.`
            }</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">3</span><div>
            <strong>Dépôt auprès de la ${A.DDT} du Pas-de-Calais</strong>
            <p>Service Eau et Risques — 62000 Arras — ddt@pas-de-calais.gouv.fr — Tél. 03 21 21 20 00<br>Dépôt en ligne : portail ${A.IOTA}.eau (eau.gouv.fr)</p>
          </div></div>
          ${s2 ? `<div class="adm-dc-step"><span class="adm-dc-step-num">4</span><div>
            <strong>Instruction et enquête publique éventuelle</strong>
            <p>L'arrêté préfectoral doit être obtenu avant tout démarrage de chantier. Délai : 6 à 12 mois.</p>
          </div></div>` : ''}
          <div class="adm-dc-step"><span class="adm-dc-step-num">${s2 ? '5' : '4'}</span><div>
            <strong>${s2 ? 'Arrêté préfectoral' : 'Récépissé de déclaration'} — démarrage chantier</strong>
            <p>${s2
              ? 'Conservation de l\'arrêté sur chantier obligatoire.'
              : 'Délai 2 mois (recours). Les travaux peuvent débuter à réception, sauf opposition préfectorale.'
            }</p>
          </div></div>
        </div>
        <div class="adm-dc-alert">⚠️ Sans dossier : arrêt de chantier + remise en état + amende jusqu'à <strong>15 000 €</strong></div>
      </div>
    </div>`;
  }

  // ── NATURA 2000 ─────────────────────────────────────────────
  if (natFound.length) {
    const sites = natFound.map(z => z.name.includes('Habitats') ? `${A.ZSC}/${A.SIC}` : A.ZPS).join(' + ');
    html += `
    <div class="adm-demarche-card adm-dc-eco">
      <div class="adm-dc-header">
        <span class="adm-dc-icon">🌿</span>
        <div>
          <div class="adm-dc-title">${A.EIN} — Évaluation des Incidences Natura 2000</div>
          <div class="adm-dc-subtitle">Art. L.414-4 C. env. — Sites ${sites} détectés</div>
        </div>
        <span class="adm-dc-level adm-dc-lv-eco">${A.EIN} requise</span>
      </div>
      <div class="adm-dc-body">
        <div class="adm-dc-steps">
          <div class="adm-dc-step"><span class="adm-dc-step-num">1</span><div>
            <strong>Vérifier les listes nationale et locale</strong>
            <p>Consulter l'art. R.414-19 (liste nationale) et la liste locale Pas-de-Calais. Les travaux en cours d'eau en zone Natura 2000 sont généralement listés.</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">2</span><div>
            <strong>Niveau 1 — Fiche simplifiée (sans incidence notable)</strong>
            <p>Localisation, distance au site Natura, espèces/habitats visés par le ${A.FSD} (Formulaire Standard de Données), justification de l'absence d'impact. Annexée au dossier principal.</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">3</span><div>
            <strong>Niveau 2 — Dossier complet (si incidences probables)</strong>
            <p>Analyse des effets cumulés, mesures d'atténuation, justification de l'absence d'atteinte aux objectifs de conservation. Instruit par la ${A.DREAL} Hauts-de-France.</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">4</span><div>
            <strong>Joindre l'${A.EIN} à la demande d'autorisation principale</strong>
            <p>L'${A.EIN} est annexée au dossier Loi sur l'eau ou autre autorisation. La ${A.DDT} est l'autorité instructrice de premier niveau.</p>
          </div></div>
        </div>
        <div class="adm-dc-alert">📞 ${A.DREAL} Hauts-de-France — Tél. 03 20 13 48 48 · Formulaire sur natura2000.fr · Délai : 2 à 6 mois</div>
      </div>
    </div>`;
  }

  // ── ZNIEFF ──────────────────────────────────────────────────
  if (zniFound.length) {
    const types = [...new Set(zniFound.map(z => z.name.includes('type I') ? 'Type I' : 'Type II'))].join(' + ');
    html += `
    <div class="adm-demarche-card adm-dc-zni">
      <div class="adm-dc-header">
        <span class="adm-dc-icon">🌱</span>
        <div>
          <div class="adm-dc-title">${A.ZNIEFF} ${esc(types)} — Vigilance environnementale</div>
          <div class="adm-dc-subtitle">Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique — inventaire scientifique sans obligation directe</div>
        </div>
        <span class="adm-dc-level adm-dc-lv-zni">Vigilance</span>
      </div>
      <div class="adm-dc-body">
        <div class="adm-dc-steps">
          <div class="adm-dc-step"><span class="adm-dc-step-num">!</span><div>
            <strong>Pas de procédure réglementaire autonome</strong>
            <p>La ${A.ZNIEFF} ne crée pas d'obligation légale directe, mais signale une forte valeur biologique qui influence l'instruction des autres dossiers.</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">1</span><div>
            <strong>Mentionner la ${A.ZNIEFF} dans tous les dossiers</strong>
            <p>Signaler systématiquement sa présence dans les notices d'incidence Loi sur l'eau et ${A.EIN}. Le service instructeur sera plus exigeant.</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">2</span><div>
            <strong>Étude faune-flore possible (${A.ZNIEFF} Type I)</strong>
            <p>En ${A.ZNIEFF} de type I, le service instructeur peut imposer une étude d'impact par un écologue agréé (état initial, mesures ${A.ERC} : Éviter / Réduire / Compenser).</p>
          </div></div>
          <div class="adm-dc-step"><span class="adm-dc-step-num">3</span><div>
            <strong>Précautions opérationnelles</strong>
            <p>Adapter les dates (hors nidification mars–août, hors fraye printanière), baliser les zones sensibles, interdire les rejets directs dans le milieu aquatique.</p>
          </div></div>
        </div>
        <div class="adm-dc-alert">ℹ️ Inventaire ${A.ZNIEFF} : inpn.mnhn.fr · Avis préalable informel ${A.DREAL} Hauts-de-France conseillé</div>
      </div>
    </div>`;
  }

  // ── ACCOMPAGNEMENT DEMANDÉ ──────────────────────────────────
  if (demandeAccomp) {
    html += `
    <div class="adm-accomp-info">
      ✋ <strong>Le client a demandé un accompagnement dans les démarches administratives.</strong><br>
      Préparer un devis spécifique pour la constitution et le suivi des dossiers réglementaires. Si nécessaire, s'appuyer sur un bureau d'études partenaire (hydraulique/environnement).
    </div>`;
  }

  // ── LÉGENDE DES SIGLES ───────────────────────────────────────
  html += `
  <div class="adm-glossaire">
    <strong>Sigles utilisés</strong>
    <ul>
      <li>${A.IOTA} — Installations, Ouvrages, Travaux et Activités (régime d'autorisation Loi sur l'eau)</li>
      <li>${A.DDT} / ${A.DDTM} — Direction Départementale des Territoires (et de la Mer)</li>
      <li>${A.DREAL} — Direction Régionale de l'Environnement, de l'Aménagement et du Logement</li>
      <li>${A.EIN} — Évaluation des Incidences Natura 2000</li>
      <li>${A.ZSC} — Zone Spéciale de Conservation · ${A.SIC} — Site d'Importance Communautaire · ${A.ZPS} — Zone de Protection Spéciale</li>
      <li>${A.FSD} — Formulaire Standard de Données Natura 2000</li>
      <li>${A.ZNIEFF} — Zone Naturelle d'Intérêt Écologique, Faunistique et Floristique</li>
      <li>${A.ERC} — Éviter, Réduire, Compenser (séquence de mesures environnementales)</li>
    </ul>
  </div>`;

  html += '</div>';
  return html;
}
