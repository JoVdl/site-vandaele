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
const db      = firebase.firestore();
const storage = firebase.storage();

const DEPOT_LAT = 50.317867;
const DEPOT_LNG = 1.915533;

let allDemandes   = [];
let currentFilter = 'all';
let currentSearch = '';
let adminMap      = null;
let routeMap      = null;
let currentSort   = 'desc';
let openId               = null;
let unsubscribe          = null;
let unsubscribeAbandons  = null;

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

document.getElementById('btn-google')?.addEventListener('click', async () => {
  const btn  = document.getElementById('btn-google');
  const errEl = document.getElementById('login-error');
  btn.disabled    = true;
  btn.textContent = 'Connexion…';
  errEl.hidden    = true;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (err) {
    const msgs = {
      'auth/popup-closed-by-user': 'Fenêtre fermée. Réessayez.',
      'auth/popup-blocked':        'Popup bloqué par le navigateur. Autorisez les popups pour ce site.',
      'auth/operation-not-allowed':'Google non activé dans Firebase Console (Authentication → Sign-in method).',
      'auth/unauthorized-domain':  'Domaine non autorisé dans Firebase Console (Authentication → Settings → Authorized domains).',
    };
    errEl.textContent = msgs[err.code] || `Erreur : ${err.code}`;
    errEl.hidden = false;
    btn.disabled    = false;
    btn.innerHTML   = `<svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h13.2c-.6 3-2.3 5.5-4.9 7.2v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z"/><path fill="#34A853" d="M24 48c6.5 0 12-2.2 16-5.9l-7.9-6c-2.2 1.5-5 2.3-8.1 2.3-6.2 0-11.5-4.2-13.4-9.9H2.5v6.2C6.5 42.9 14.7 48 24 48z"/><path fill="#FBBC05" d="M10.6 28.5c-.5-1.5-.8-3.1-.8-4.5s.3-3 .8-4.5v-6.2H2.5C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l8.1-6.2z"/><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.8-6.8C35.9 2.3 30.4 0 24 0 14.7 0 6.5 5.1 2.5 13.3l8.1 6.2C12.5 13.7 17.8 9.5 24 9.5z"/></svg> Continuer avec Google`;
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
  stopAbandonsListener();
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

  if (currentFilter === 'abandons') {
    startAbandonsListener(listEl);
    return;
  }

  stopAbandonsListener();

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

const PANEL_LABELS = ['', 'Zone de travaux', 'Problèmes rencontrés', 'Choix des travaux', 'Détails du chantier', 'Vos coordonnées', 'Résultat'];

function stopAbandonsListener() {
  if (unsubscribeAbandons) { unsubscribeAbandons(); unsubscribeAbandons = null; }
}

function startAbandonsListener(listEl) {
  if (unsubscribeAbandons) {
    // Listener déjà actif — juste re-render si le contenu a changé entre-temps
    return;
  }
  listEl.innerHTML = '<div class="state-msg">Chargement des sessions…</div>';

  unsubscribeAbandons = db.collection('abandons')
    .orderBy('created_at', 'desc')
    .limit(500)
    .onSnapshot(snap => {
      if (snap.empty) {
        listEl.innerHTML = '<div class="state-msg">Aucune session enregistrée.</div>';
        return;
      }
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      listEl.innerHTML = buildAbandonsHtml(docs);
    }, err => {
      console.error('[Firebase] Abandons listener error:', err);
      listEl.innerHTML = '<div class="state-msg">Erreur de chargement.</div>';
    });
}

function buildAbandonsHtml(docs) {
  const total          = docs.length;
  const completedDocs  = docs.filter(d => d.completed);
  const abandonedDocs  = docs.filter(d => !d.completed);
  const completionRate = total ? Math.round((completedDocs.length / total) * 100) : 0;
  const abandonRate    = 100 - completionRate;

  // Entonnoir : sessions ayant atteint AU MOINS chaque étape
  const funnelCounts = [1, 2, 3, 4, 5].map(p => docs.filter(d => (d.last_panel || 1) >= p).length);
  funnelCounts.push(completedDocs.length); // étape 6 = finalisées

  // Abandons par étape (où s'arrêtent ceux qui ne finalisent pas)
  const stopByPanel = {};
  abandonedDocs.forEach(d => {
    const p = d.last_panel || 1;
    stopByPanel[p] = (stopByPanel[p] || 0) + 1;
  });

  // Raisons
  const reasonCounts = {};
  abandonedDocs.filter(d => d.reason).forEach(d => {
    reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
  });
  const reasonEntries   = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const totalWithReason = reasonEntries.reduce((s, [, v]) => s + v, 0);
  const unknownAbandon  = abandonedDocs.length - totalWithReason;

  // Appareils
  const mobile  = docs.filter(d => d.device === 'mobile').length;
  const desktop = docs.filter(d => d.device === 'desktop').length;
  const unknownDev = total - mobile - desktop;

  return `
    <div class="ab-stats-block">

      <div class="ab-kpi-row">
        <div class="ab-kpi">
          <div class="ab-kpi-val">${total}</div>
          <div class="ab-kpi-lbl">Sessions</div>
        </div>
        <div class="ab-kpi ab-kpi-ok">
          <div class="ab-kpi-val">${completedDocs.length} <span class="ab-kpi-pct">${completionRate}%</span></div>
          <div class="ab-kpi-lbl">Finalisées</div>
        </div>
        <div class="ab-kpi ab-kpi-warn">
          <div class="ab-kpi-val">${abandonedDocs.length} <span class="ab-kpi-pct">${abandonRate}%</span></div>
          <div class="ab-kpi-lbl">Abandons</div>
        </div>
      </div>

      <div class="ab-section-title">Entonnoir de conversion</div>
      ${[1,2,3,4,5,6].map((p, i) => {
        const count    = funnelCounts[i];
        const pct      = total ? Math.round((count / total) * 100) : 0;
        const stopHere = p < 6 ? (stopByPanel[p] || 0) : 0;
        return `
          <div class="ab-funnel-row">
            <div class="ab-funnel-lbl">${p === 6 ? '✅' : p + '.'} ${PANEL_LABELS[p]}</div>
            <div class="ab-funnel-bar-wrap">
              <div class="ab-funnel-bar${p === 6 ? ' ab-bar-ok' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="ab-funnel-meta">
              ${pct}% <span class="ab-fn">(${count})</span>
              ${stopHere ? `<span class="ab-stop-here">−${stopHere} ici</span>` : ''}
            </div>
          </div>`;
      }).join('')}

      <div class="ab-section-title">Raisons d'abandon</div>
      ${reasonEntries.length ? reasonEntries.map(([reason, count]) => {
        const pct = totalWithReason ? Math.round((count / totalWithReason) * 100) : 0;
        return `
          <div class="ab-funnel-row">
            <div class="ab-funnel-lbl">${esc(reason)}</div>
            <div class="ab-funnel-bar-wrap">
              <div class="ab-funnel-bar ab-bar-reason" style="width:${pct}%"></div>
            </div>
            <div class="ab-funnel-meta">${pct}% <span class="ab-fn">(${count})</span></div>
          </div>`;
      }).join('') + (unknownAbandon > 0 ? `
        <div class="ab-funnel-row">
          <div class="ab-funnel-lbl" style="color:var(--gray-400)">Non capturée</div>
          <div class="ab-funnel-bar-wrap">
            <div class="ab-funnel-bar ab-bar-reason" style="width:${Math.round((unknownAbandon / abandonedDocs.length) * 100)}%;opacity:.35"></div>
          </div>
          <div class="ab-funnel-meta" style="color:var(--gray-400)">${Math.round((unknownAbandon / abandonedDocs.length) * 100)}% <span class="ab-fn">(${unknownAbandon})</span></div>
        </div>` : '')
      : `<div class="ab-empty-hint">Aucune raison capturée pour l'instant — les données arrivent au fil des nouvelles sessions.</div>`}

      <div class="ab-section-title">Appareils</div>
      <div class="ab-device-row">
        ${[['📱 Mobile', mobile], ['🖥️ PC / Tablette', desktop], ['❓ Inconnu', unknownDev]].map(([label, count]) => {
          const pct = total ? Math.round((count / total) * 100) : 0;
          return `
            <div class="ab-device-card">
              <div class="ab-device-val">${count}</div>
              <div class="ab-device-lbl">${label}</div>
              <div class="ab-device-pct">${pct}%</div>
            </div>`;
        }).join('')}
      </div>

      <div class="ab-section-title">Sessions récentes</div>
    </div>

    ${docs.slice(0, 50).map(d => {
      const panel      = d.last_panel || 1;
      const panelLabel = PANEL_LABELS[panel] || `Étape ${panel}`;
      const done       = d.completed === true;
      const dateStr    = d.created_at?.toDate ? fmtRelative(d.created_at) : '–';
      const deviceIcon = d.device === 'mobile' ? '📱' : d.device === 'desktop' ? '🖥️' : '';
      return `
        <div class="abandon-card ${done ? 'ab-completed' : 'ab-abandoned'}">
          <div class="ab-main">
            <div class="ab-step">${deviceIcon} Étape ${panel} — ${esc(panelLabel)}</div>
            <div class="ab-date">${dateStr}${d.reason ? ` · ${esc(d.reason)}` : ''}</div>
          </div>
          <div class="ab-badge">${done ? '✅ Finalisé' : '⚠️ Abandonné'}</div>
        </div>`;
    }).join('')}
  `;
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
        ${!isContact && d.recontact === true  ? `<div class="card-recontact rc-oui">📞 À rappeler</div>` : ''}
        ${!isContact && d.recontact === false ? `<div class="card-recontact rc-non">✉️ Pas de rappel</div>` : ''}
        ${!isContact && d.recontact === null  ? `<div class="card-recontact rc-pending">⏳ En attente</div>` : ''}
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
    if (details.hydrocurage) {
      detailRows += drow('Hydrocurage', `Épaisseur : ${details.hydrocurage.epaisseur_cm ?? '–'} cm · Volume : ${details.hydrocurage.volume_m3 ?? details.hydrocurage.longueur_ml ?? '–'} m³`);
      if (details.hydrocurage.destination_vase === 'sur-place') {
        if (details.hydrocurage.epandage_surface_m2) {
          const s = details.hydrocurage.epandage_surface_m2;
          detailRows += drow('Épandage hydrocurage – surface', `${Math.round(s).toLocaleString('fr')} m² (${(s / 10000).toFixed(2)} ha)`);
        }
        if (d.lat && d.lng && d.lat_epandage_hydro && d.lng_epandage_hydro) {
          const distM = Math.round(haversineKm(d.lat, d.lng, d.lat_epandage_hydro, d.lng_epandage_hydro) * 1000);
          detailRows += drow('Épandage hydrocurage – distance étang', `${distM} m`);
        }
      }
    }
    if (details.curage) {
      detailRows += drow('Curage – prof. vase', `${details.curage.prof_vase_cm} cm`);
      detailRows += drow('Curage – surface concernée', `${details.curage.pct_surface} %`);
      detailRows += drow('Destination de la vase', destMap[details.curage.destination_vase] || details.curage.destination_vase);
      if (details.curage.destination_vase === 'sur-place') {
        if (details.curage.epandage_surface_m2) {
          const s = details.curage.epandage_surface_m2;
          detailRows += drow('Épandage curage – surface', `${Math.round(s).toLocaleString('fr')} m² (${(s / 10000).toFixed(2)} ha)`);
        }
        if (d.lat && d.lng && d.lat_epandage_curage && d.lng_epandage_curage) {
          const distM = Math.round(haversineKm(d.lat, d.lng, d.lat_epandage_curage, d.lng_epandage_curage) * 1000);
          detailRows += drow('Épandage curage – distance étang', `${distM} m`);
        }
      }
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
      ${d.recontact === true ? `
      <div class="adm-recontact-banner adm-recontact-oui">
        📞 <strong>Le client souhaite être recontacté</strong> — à rappeler dans les 48h pour affiner le chiffrage.
      </div>` : d.recontact === false ? `
      <div class="adm-recontact-banner adm-recontact-non">
        ✉️ <strong>Pas de demande de rappel</strong> — le client a consulté l'estimation sans suite.
      </div>` : d.recontact === null ? `
      <div class="adm-recontact-banner adm-recontact-pending">
        ⏳ <strong>En attente de réponse</strong> — le client n'a pas encore choisi.
      </div>` : ''}

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
        ${(d.geojson || (d.lat && d.lng) || d.lat_epandage_hydro || d.lat_epandage_curage) ? `<div id="admin-map" style="height:240px;margin-top:.9rem;border-radius:8px;overflow:hidden;background:var(--gray-200);"></div>` : ''}
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

      <div class="dsec">
        <h3>📊 Estimation indicative</h3>
        ${(d.estimation_lines && d.estimation_lines.length) ? `
        <table style="width:100%;border-collapse:collapse;font-size:.83rem;margin-bottom:.75rem;">
          ${d.estimation_lines.map(l => `
          <tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:.35rem .1rem;color:var(--gray-600);">${esc(l.label)}</td>
            <td style="padding:.35rem .1rem;text-align:right;font-weight:600;color:var(--gray-800);white-space:nowrap;">${esc(l.val)}</td>
          </tr>`).join('')}
        </table>` : ''}
        <div class="est-total">
          <div class="est-total-label">Total indicatif</div>
          <div class="est-total-val">${esc(d.estimation_text || '–')}</div>
        </div>
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
  if (d.geojson || (d.lat && d.lng) || d.lat_epandage_hydro || d.lat_epandage_curage) {
    let geojson = null;
    try {
      geojson = d.geojson
        ? (typeof d.geojson === 'string' ? JSON.parse(d.geojson) : d.geojson)
        : null;
    } catch (e) { console.error('GeoJSON parse error:', e); }

    const epandageOverlays = [];
    if (d.lat_epandage_hydro && d.lng_epandage_hydro)
      epandageOverlays.push({ geojsonStr: d.geojson_epandage_hydro, eLat: d.lat_epandage_hydro, eLng: d.lng_epandage_hydro, label: 'Zone d\'épandage' });
    if (d.lat_epandage_curage && d.lng_epandage_curage)
      epandageOverlays.push({ geojsonStr: d.geojson_epandage_curage, eLat: d.lat_epandage_curage, eLng: d.lng_epandage_curage, label: 'Zone d\'épandage (curage)' });

    loadLeaflet(() => setTimeout(() => renderAdminMap(geojson, d.lat, d.lng, epandageOverlays), 80));
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

function renderAdminMap(geojson, lat, lng, epandageOverlays = []) {
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

    adminMap.invalidateSize();

    const allBounds = [];

    if (geojson) {
      const layer = L.geoJSON(geojson, {
        style: { color: '#3d9e62', weight: 2.5, fillColor: '#56b57a', fillOpacity: 0.2 }
      }).addTo(adminMap);
      try { allBounds.push(layer.getBounds()); } catch(e) {}
    } else if (lat && lng) {
      L.circleMarker([lat, lng], { radius: 7, color: '#3d9e62', fillColor: '#56b57a', fillOpacity: 0.8, weight: 2 }).addTo(adminMap);
      allBounds.push(L.latLngBounds([[lat - 0.001, lng - 0.001], [lat + 0.001, lng + 0.001]]));
    }

    const epandageColors = ['#f59e0b', '#3b82f6'];
    epandageOverlays.forEach(({ geojsonStr, eLat, eLng }, idx) => {
      const color = epandageColors[idx] || '#f59e0b';
      let eGeo = null;
      try { eGeo = geojsonStr ? (typeof geojsonStr === 'string' ? JSON.parse(geojsonStr) : geojsonStr) : null; } catch(e) {}
      if (eGeo) {
        const eLayer = L.geoJSON(eGeo, {
          style: { color, weight: 2, fillColor: color, fillOpacity: 0.15, dashArray: '5 5' }
        }).addTo(adminMap);
        try { allBounds.push(eLayer.getBounds()); } catch(e) {}
      } else if (eLat && eLng) {
        L.circleMarker([eLat, eLng], { radius: 7, color, fillColor: color, fillOpacity: 0.8, weight: 2 }).addTo(adminMap);
        allBounds.push(L.latLngBounds([[eLat - 0.001, eLng - 0.001], [eLat + 0.001, eLng + 0.001]]));
      }
    });

    if (allBounds.length > 0) {
      try {
        const combined = allBounds.reduce((acc, b) => acc.extend(b));
        adminMap.fitBounds(combined, { padding: [28, 28] });
      } catch(e) {
        if (lat && lng) adminMap.setView([lat, lng], 15);
      }
    }

    // Légende si étang + épandage visibles ensemble
    if ((geojson || (lat && lng)) && epandageOverlays.length > 0) {
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.style.cssText = 'background:rgba(255,255,255,.92);padding:4px 8px;border-radius:6px;font-size:11px;line-height:1.8;box-shadow:0 1px 4px rgba(0,0,0,.2);pointer-events:none;';
        const rows = [`<div><span style="display:inline-block;width:11px;height:11px;background:#56b57a;border:1.5px solid #3d9e62;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Étang</div>`];
        epandageOverlays.forEach(({ label }, idx) => {
          const c = epandageColors[idx] || '#f59e0b';
          rows.push(`<div><span style="display:inline-block;width:11px;height:11px;background:${c};border:1.5px solid ${c};border-radius:2px;margin-right:5px;vertical-align:middle;opacity:.7;"></span>${esc(label)}</div>`);
        });
        div.innerHTML = rows.join('');
        return div;
      };
      legend.addTo(adminMap);
    }

    setTimeout(() => { if (adminMap) adminMap.invalidateSize(); }, 300);
  } catch (err) {
    console.error('Map render error:', err);
  }
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
    _appendTrackingSection(container, d, []);
    return;
  }
  if (found.length === 0) {
    container.innerHTML = '<p class="adm-zone-ok">✅ Aucune zone protégée détectée à cette localisation.</p>';
    _appendTrackingSection(container, d, []);
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

  // Map upstream type codes to determineProcedures format (nat/zni → eco)
  const zonesForTracking = found.map(z => ({
    type: z.type === 'zh' ? 'zh' : 'eco',
    name: z.name,
    siteName: z.siteName || '',
  }));
  _appendTrackingSection(container, d, zonesForTracking);
}

let _docCtx = null;

function _appendTrackingSection(container, d, zones) {
  const procs = determineProcedures(d, zones);
  if (!procs.length) return;
  _docCtx = { d, zones };
  const saved = d.demarches || {};
  const wrap  = document.createElement('div');
  wrap.className = 'adm-tracking';
  wrap.innerHTML = '<div class="adm-tracking-title">Suivi des dossiers &amp; pièces à préparer</div>' +
    renderDemarchesHtml(d, zones, procs, saved);
  container.appendChild(wrap);
  initDemarchesListeners(d, procs, zones);
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

// ── ROUTE MODAL ──────────────────────────────────────────────
detailPane.addEventListener('click', e => {
  const badge = e.target.closest('.dist-badge');
  if (!badge) return;
  const d = allDemandes.find(x => x.id === openId);
  if (!d?.lat || !d?.lng) return;
  showRouteModal(d.lat, d.lng);
});

document.getElementById('route-modal-close').addEventListener('click', closeRouteModal);
document.getElementById('route-modal').addEventListener('click', e => {
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

    const depotIcon    = L.divIcon({ html: '<div style="font-size:1.3rem;line-height:1">🏠</div>', className: '', iconSize: [24,24], iconAnchor: [12,12] });
    const chantierIcon = L.divIcon({ html: '<div style="font-size:1.3rem;line-height:1">📍</div>', className: '', iconSize: [24,24], iconAnchor: [12,24] });
    L.marker([DEPOT_LAT, DEPOT_LNG], { icon: depotIcon }).bindPopup('<strong>Dépôt</strong><br>Tortefontaine').addTo(routeMap);
    L.marker([lat, lng], { icon: chantierIcon }).bindPopup('<strong>Chantier</strong>').addTo(routeMap);

    routeMap.fitBounds([[DEPOT_LAT, DEPOT_LNG], [lat, lng]], { padding: [48, 48] });
    routeMap.invalidateSize();

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

// ── RÉALISATIONS ─────────────────────────────────────────────────────────────

const REAL_SEED = [
  { titre:"Curage des douves d'un château", lieu:"Dammartin-sur-Tigeaux (77)", categorie:"curage", badge:"Curage", description:"Plus de 2 000 m³ de vases extraites. L'utilisation de la drague aspiratrice a permis de ne pas endommager les berges ni la végétation patrimoniale bordant les douves.", image:"assets/img/curage-de-douves.jpg", imageAlt:"Curage des douves du château de Dammartin-sur-Tigeaux par drague aspiratrice", specs:["📦 2 000 m³","⚙️ Drague aspiratrice","📅 2021"], ordre:1, visible:true },
  { titre:"Fauchage de roseaux et touradons", lieu:"Somme (80)", categorie:"faucardage", badge:"Faucardage", description:"Intervention pour le compte du Conservatoire des Espaces Naturels. Machine équipée de chenilles larges permettant d'accéder aux zones les plus inaccessibles des marais.", image:"assets/img/fauchage-de-roseaux-avec-exportation.jpg", imageAlt:"Fauchage de roseaux dans les marais de la Somme", specs:["🌿 Roseaux + Touradons","🏛️ Conservatoire EN","⚙️ Chenilles larges"], ordre:2, visible:true },
  { titre:"Curage d'une lagune quasi asséchée", lieu:"Frelinghin (Nord, 59)", categorie:"curage", badge:"Curage", description:"L'étang était presque à sec. Après le passage de la drague aspiratrice, l'étang a retrouvé 2 mètres de profondeur et une qualité d'eau nettement améliorée.", image:"assets/img/curage-de-lagunes.jpg", imageAlt:"Curage d'une lagune industrielle à Frelinghin", specs:["💧 +2 m profondeur","⚙️ Drague aspiratrice"], ordre:3, visible:true },
  { titre:"Curage d'étang à sec", lieu:"Albert (Somme, 80)", categorie:"curage", badge:"Curage", description:"Curage d'un étang mis à sec à l'aide d'engins équipés de chenilles spéciales marais. Technique adaptée aux terrains meubles et gorgés d'eau pour éviter l'enlisement du matériel.", image:"assets/img/curage-d-etang-avec-mise-en-assec.jpg", imageAlt:"Curage d'étang à sec avec engins chenilles marais à Albert", specs:["⚙️ Chenilles marais","🔓 Mise à sec"], ordre:4, visible:true },
  { titre:"Suppression de nénuphars", lieu:"Wail (Pas-de-Calais, 62)", categorie:"faucardage", badge:"Faucardage", description:"Arrachage et extraction de nénuphars couvrant une large portion du plan d'eau. Intervention mécanique depuis la berge et par bateau faucardeur pour les zones profondes.", image:"assets/img/suppression-de-nenuphars.jpg", imageAlt:"Suppression de nénuphars sur étang à Wail", specs:["🌸 Nénuphars","⚙️ Bateau faucardeur"], ordre:5, visible:true },
  { titre:"Enrochement – Étang de chasse", lieu:"Pas-de-Calais (62)", categorie:"berges", badge:"Défenses de berges", description:"Protection de berges fortement érodées par pose de blocs calcaires, géotextile et végétalisation adaptée. Résultat immédiat sur la stabilisation des rives.", image:"assets/img/terrassement-defense-des-berges-enrochements.jpg", imageAlt:"Enrochement et terrassement de berges dans le Pas-de-Calais", specs:["🪨 Enrochement","🌱 Végétalisation"], ordre:6, visible:true },
  { titre:"Location de drague avec chauffeur", lieu:"Hauts-de-France", categorie:"curage", badge:"Curage", description:"Mise à disposition de matériel de dévasement (drague aspiratrice, pelle amphibie) avec chauffeur qualifié pour maîtres d'ouvrage publics et privés.", image:"assets/img/location-materiel-avec-ou-sans-chauffeur-2.jpg", imageAlt:"Location de drague aspiratrice avec chauffeur en Hauts-de-France", specs:["🚜 Matériel spécialisé","👷 Avec chauffeur"], ordre:7, visible:true },
  { titre:"Entretien plan d'eau – Agence Sud-Ouest", lieu:"Gironde (33)", categorie:"curage", badge:"Curage", description:"Intervention depuis notre agence d'Arbanats (Gironde) sur un plan d'eau privé. Curage et remise en état des berges pour un propriétaire souhaitant relancer l'activité piscicole.", image:"assets/img/travaux-de-curage.jpg", imageAlt:"Travaux de curage d'étang privé en Gironde", specs:["🐟 Remise en pêche","📍 Agence SW"], ordre:8, visible:true },
];

let allRealisations  = [];
let realUnsubscribe  = null;
let currentMedia     = [];

function realCatLabel(c) {
  return { curage:'Curage', faucardage:'Faucardage', berges:'Berges', broyage:'Broyage' }[c] || c;
}

// ── Navigation section ────────────────────────────────────────
document.getElementById('btn-real-section')?.addEventListener('click', () => {
  showRealisationsSection();
});

// Status filter buttons → back to demandes
document.querySelectorAll('.fnav-btn[data-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!document.getElementById('realisations-panel').classList.contains('active')) return;
    hideRealisationsSection();
  });
});

function showRealisationsSection() {
  document.getElementById('realisations-panel').classList.add('active');
  document.querySelector('.admin-content').style.display = 'none';
  const tp = document.getElementById('tarifs-panel');
  if (!tp.hidden) { tp.hidden = true; document.getElementById('btn-tarifs')?.classList.remove('active'); }
  document.getElementById('btn-real-section').classList.add('active');
  if (!realUnsubscribe) startRealListener();
}

function hideRealisationsSection() {
  document.getElementById('realisations-panel').classList.remove('active');
  document.querySelector('.admin-content').style.display = '';
  document.getElementById('btn-real-section').classList.remove('active');
}

// Also hide realisations when tarifs button clicked
const _origTarifsClick = document.getElementById('btn-tarifs')?.onclick;
document.getElementById('btn-tarifs')?.addEventListener('click', () => {
  hideRealisationsSection();
});

function startRealListener() {
  realUnsubscribe = db.collection('realisations')
    .orderBy('ordre', 'asc')
    .onSnapshot(async snap => {
      allRealisations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (allRealisations.length === 0) await seedRealisations();
      else renderRealList();
    }, err => console.error('[Real] listener error:', err));
}

async function seedRealisations() {
  const check = await db.collection('realisations').limit(1).get();
  if (!check.empty) return;
  const batch = db.batch();
  REAL_SEED.forEach(r => {
    batch.set(db.collection('realisations').doc(), {
      ...r,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
}

function renderRealList() {
  const container = document.getElementById('real-list');
  if (!container) return;
  if (!allRealisations.length) {
    container.innerHTML = '<div class="state-msg">Aucune réalisation. Cliquez sur « Ajouter ».</div>';
    return;
  }
  container.innerHTML = allRealisations.map(r => {
    const allMedia = r.media?.length ? r.media : (r.image ? [{ url: r.image, type: 'image' }] : []);
    const showThumbs = allMedia.slice(0, 4);
    const extra = allMedia.length - 4;
    const thumbsHtml = allMedia.length === 0
      ? `<div class="real-thumb-empty">📷</div>`
      : showThumbs.map((m, mi) => m.type === 'video'
          ? `<video class="real-thumb" src="${esc(m.url)}" muted playsinline preload="metadata" onloadedmetadata="this.currentTime=0.5" onclick="openLightboxForReal('${r.id}',${mi})"></video>`
          : `<img class="real-thumb" src="${esc(m.url)}" alt="" onerror="this.style.visibility='hidden'" onclick="openLightboxForReal('${r.id}',${mi})">`
        ).join('')
        + (extra > 0 ? `<div class="real-thumb-more" onclick="openLightboxForReal('${r.id}',4)">+${extra}</div>` : '');

    const specsHtml = r.specs?.length
      ? `<div class="real-specs">${r.specs.map(s => `<span class="real-spec-chip">${esc(s)}</span>`).join('')}</div>`
      : '';

    return `
    <div class="real-row" draggable="true" data-id="${r.id}">
      <div class="real-row-top">
        <span class="real-drag-handle" title="Glisser pour réorganiser">⠿</span>
        <div class="real-thumbs">${thumbsHtml}</div>
        <div class="real-actions">
          <button class="real-btn" title="Modifier" onclick="openRealModal('${r.id}')">✏️</button>
          <button class="real-btn danger" title="Supprimer" onclick="deleteReal('${r.id}','${esc(r.titre).replace(/'/g,"\\'")}')">🗑️</button>
        </div>
      </div>
      <div class="real-row-body">
        <div class="real-titre">${esc(r.titre)}</div>
        <div class="real-meta">
          <span class="real-vis-pill ${r.visible ? 'vis' : 'hid'}">${r.visible ? '● Visible' : '○ Masqué'}</span>
          <span class="real-cat-badge">${realCatLabel(r.categorie)}</span>
          <span>📍 ${esc(r.lieu)}</span>
        </div>
        ${specsHtml}
      </div>
    </div>`;
  }).join('');
  initRealListDnd();
}

function initRealListDnd() {
  const list = document.getElementById('real-list');
  if (!list) return;
  let dragId = null;

  list.querySelectorAll('.real-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.real-row').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (row.dataset.id !== dragId) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault();
      const overId = row.dataset.id;
      if (!dragId || overId === dragId) return;
      const dragIdx = allRealisations.findIndex(r => r.id === dragId);
      const overIdx = allRealisations.findIndex(r => r.id === overId);
      if (dragIdx < 0 || overIdx < 0) return;
      const reordered = [...allRealisations];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(overIdx, 0, moved);
      const batch = db.batch();
      reordered.forEach((r, i) => {
        if (r.ordre !== i + 1) batch.update(db.collection('realisations').doc(r.id), { ordre: i + 1 });
      });
      await batch.commit();
      dragId = null;
    });
  });
}

function openRealModal(id = null) {
  const r = id ? allRealisations.find(x => x.id === id) : null;
  document.getElementById('rm-modal-title').textContent = id ? 'Modifier la réalisation' : 'Ajouter une réalisation';
  document.getElementById('rm-id').value          = id || '';
  document.getElementById('rm-titre').value       = r?.titre || '';
  document.getElementById('rm-lieu').value        = r?.lieu || '';
  document.getElementById('rm-categorie').value   = r?.categorie || 'curage';
  document.getElementById('rm-badge').value       = r?.badge || '';
  document.getElementById('rm-description').value = r?.description || '';
  document.getElementById('rm-specs').value       = (r?.specs || []).join('\n');
  document.getElementById('rm-visible').checked   = r?.visible !== false;

  // Load media
  if (r?.media?.length) {
    currentMedia = r.media.map(m => ({ ...m }));
  } else if (r?.image) {
    currentMedia = [{ url: r.image, type: 'image', alt: r.imageAlt || '' }];
  } else {
    currentMedia = [];
  }
  renderMediaGrid();
  document.getElementById('real-modal').hidden = false;
}

function closeRealModal() {
  document.getElementById('real-modal').hidden = true;
  currentMedia = [];
}

// ── Media upload & gallery ────────────────────────────────────

function initMediaZone() {
  const zone = document.getElementById('rm-upload-zone');
  const inp  = document.getElementById('rm-file-input');
  if (!zone || !inp) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    handleMediaFiles([...e.dataTransfer.files]);
  });
  zone.addEventListener('click', e => { if (!e.target.closest('label')) inp.click(); });
  inp.addEventListener('change', () => { handleMediaFiles([...inp.files]); inp.value = ''; });
}

async function handleMediaFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
    const ph = addMediaPlaceholder();
    try {
      const item = await uploadMediaFile(file, pct => {
        const bar = ph.querySelector('.rm-progress-bar');
        if (bar) bar.style.width = pct + '%';
      });
      currentMedia.push(item);
      renderMediaGrid();
    } catch (err) {
      ph.remove();
      alert('Erreur upload : ' + err.message);
    }
  }
}

function addMediaPlaceholder() {
  const grid = document.getElementById('rm-media-grid');
  const el = document.createElement('div');
  el.className = 'rm-media-item';
  el.innerHTML = `<div style="height:84px"></div><div class="rm-media-progress"><div class="rm-progress-bar-wrap"><div class="rm-progress-bar"></div></div><span>Upload…</span></div>`;
  grid.appendChild(el);
  return el;
}

async function uploadMediaFile(file, onProgress) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const name = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const ref  = storage.ref(`realisations/${name}`);
  await new Promise((resolve, reject) => {
    const task = ref.put(file);
    task.on('state_changed', snap => onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)), reject, resolve);
  });
  return { url: await ref.getDownloadURL(), type: file.type.startsWith('video/') ? 'video' : 'image', alt: '' };
}

function buildMediaItemHtml(item, idx) {
  const media = item.type === 'video'
    ? `<video src="${esc(item.url)}" muted playsinline preload="metadata" onloadedmetadata="this.currentTime=0.5" style="width:100%;height:84px;object-fit:cover;display:block;cursor:pointer" onclick="openLightboxFromGallery(${idx})"></video>`
    : `<img src="${esc(item.url)}" alt="" style="width:100%;height:84px;object-fit:cover;display:block;cursor:pointer" onerror="this.style.opacity='.3'" onclick="openLightboxFromGallery(${idx})">`;
  return `<div class="rm-media-item" data-idx="${idx}" draggable="true">
    ${media}
    <span class="rm-media-drag" title="Réorganiser">⠿</span>
    <button class="rm-media-del" type="button" onclick="removeMedia(${idx})" title="Supprimer">✕</button>
    <input class="rm-media-alt" type="text" placeholder="Légende (optionnel)" value="${esc(item.alt || '')}">
  </div>`;
}

function renderMediaGrid() {
  const grid = document.getElementById('rm-media-grid');
  if (!grid) return;
  grid.innerHTML = currentMedia.map((item, idx) => buildMediaItemHtml(item, idx)).join('');
  initMediaItemDnd();
}

function initMediaItemDnd() {
  const grid = document.getElementById('rm-media-grid');
  if (!grid) return;
  let dragIdx = null;
  grid.querySelectorAll('.rm-media-item').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragIdx = parseInt(el.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      grid.querySelectorAll('.rm-media-item').forEach(x => x.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (parseInt(el.dataset.idx) !== dragIdx) el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const overIdx = parseInt(el.dataset.idx);
      if (dragIdx === null || overIdx === dragIdx) return;
      syncMediaAlts();
      const [moved] = currentMedia.splice(dragIdx, 1);
      currentMedia.splice(overIdx, 0, moved);
      renderMediaGrid();
      dragIdx = null;
    });
  });
}

function removeMedia(idx) {
  syncMediaAlts();
  currentMedia.splice(idx, 1);
  renderMediaGrid();
}

function syncMediaAlts() {
  document.querySelectorAll('#rm-media-grid .rm-media-item').forEach((el, i) => {
    if (currentMedia[i]) currentMedia[i].alt = el.querySelector('.rm-media-alt')?.value?.trim() || '';
  });
}

async function saveReal(e) {
  e.preventDefault();
  syncMediaAlts();
  const id        = document.getElementById('rm-id').value;
  const categorie = document.getElementById('rm-categorie').value;
  const BADGE_MAP = { curage:'Curage', faucardage:'Faucardage', berges:'Défenses de berges', broyage:'Broyage' };
  const data = {
    titre:       document.getElementById('rm-titre').value.trim(),
    lieu:        document.getElementById('rm-lieu').value.trim(),
    categorie,
    badge:       document.getElementById('rm-badge').value.trim() || BADGE_MAP[categorie],
    description: document.getElementById('rm-description').value.trim(),
    specs:       document.getElementById('rm-specs').value.split('\n').map(s => s.trim()).filter(Boolean),
    visible:     document.getElementById('rm-visible').checked,
    media:       currentMedia,
    image:       currentMedia[0]?.url || '',
    imageAlt:    currentMedia[0]?.alt || '',
  };
  const btn = document.getElementById('rm-save-btn');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    if (id) {
      await db.collection('realisations').doc(id).update(data);
    } else {
      const maxOrdre = allRealisations.reduce((m, r) => Math.max(m, r.ordre || 0), 0);
      await db.collection('realisations').doc().set({
        ...data, ordre: maxOrdre + 1,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    closeRealModal();
  } catch (err) {
    alert('Erreur : ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
}

async function deleteReal(id, titre) {
  if (!confirm(`Supprimer « ${titre} » ?\nCette action est irréversible.`)) return;
  try {
    await db.collection('realisations').doc(id).delete();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

document.getElementById('real-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('real-modal')) closeRealModal();
});

initMediaZone();

// ── LIGHTBOX ─────────────────────────────────────────────────

let lbItems = [];
let lbIdx   = 0;

function openLightbox(items, startIdx = 0) {
  lbItems = items;
  lbIdx   = startIdx;
  showLbItem();
  document.getElementById('lightbox').hidden = false;
  document.addEventListener('keydown', lbKey);
}

function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.removeEventListener('keydown', lbKey);
  const vid = document.querySelector('#lb-content video');
  if (vid) vid.pause();
  document.getElementById('lb-content').innerHTML = '';
}

function lbKey(e) {
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   lbNav(-1);
  if (e.key === 'ArrowRight')  lbNav(1);
}

function lbNav(dir) {
  const next = lbIdx + dir;
  if (next < 0 || next >= lbItems.length) return;
  const vid = document.querySelector('#lb-content video');
  if (vid) vid.pause();
  lbIdx = next;
  showLbItem();
}

function showLbItem() {
  const item = lbItems[lbIdx];
  const content = document.getElementById('lb-content');
  content.innerHTML = item.type === 'video'
    ? `<video src="${esc(item.url)}" controls autoplay style="max-width:92vw;max-height:88vh;border-radius:6px"></video>`
    : `<img src="${esc(item.url)}" alt="${esc(item.alt || '')}" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:6px">`;
  document.getElementById('lb-prev').hidden = lbIdx === 0;
  document.getElementById('lb-next').hidden = lbIdx === lbItems.length - 1;
  const counter = document.getElementById('lb-counter');
  counter.textContent = lbItems.length > 1 ? `${lbIdx + 1} / ${lbItems.length}` : '';
}

document.getElementById('lb-bg')?.addEventListener('click', closeLightbox);

function openLightboxForReal(id, startIdx = 0) {
  const r = allRealisations.find(x => x.id === id);
  if (!r) return;
  const items = r.media?.length ? r.media : (r.image ? [{ url: r.image, type: 'image', alt: r.imageAlt || '' }] : []);
  if (items.length) openLightbox(items, Math.min(startIdx, items.length - 1));
}

function openLightboxFromGallery(idx) {
  syncMediaAlts();
  if (currentMedia.length) openLightbox(currentMedia, idx);
}

// ── DÉMARCHES ADMINISTRATIVES ────────────────────────────────
const PROC_TEMPLATES = {
  curage_declaration: {
    id: 'curage_declaration', type: 'declaration',
    label: 'Déclaration IOTA – Entretien de plan d\'eau',
    rubrique: 'Rubrique 3.2.3.0 · Code de l\'env.',
    organism: 'DDT(M) du département (service police de l\'eau)',
    delay: '1 à 2 mois',
    docs: [
      'Formulaire Cerfa n°13617 (Déclaration IOTA)',
      'Plan de situation au 1/25 000 (extrait IGN)',
      'Description des travaux et planning prévisionnel',
      'Estimation du volume de vase à extraire (m³)',
      'Destination et modalités d\'évacuation/épandage des sédiments',
      'Plan de l\'étang (cotes, berges, ouvrage de vidange)',
    ],
  },
  curage_autorisation: {
    id: 'curage_autorisation', type: 'autorisation',
    label: 'Autorisation préfectorale – Entretien de plan d\'eau',
    rubrique: 'Rubrique 3.2.3.0 · Code de l\'env.',
    organism: 'Préfecture du département (instruction DDT)',
    delay: '3 à 12 mois',
    docs: [
      'Formulaire Cerfa n°13617 (Demande d\'autorisation IOTA)',
      'Étude d\'incidences sur l\'eau et les milieux aquatiques',
      'Plan de situation au 1/25 000',
      'Plans généraux des travaux au 1/2 500',
      'Note de calcul des volumes de vase',
      'Analyse physico-chimique des sédiments (métaux lourds, PCB, HAP)',
      'Plan de gestion et de suivi des sédiments extraits',
      'Mesures compensatoires et de suivi environnemental',
    ],
  },
  zh_info: {
    id: 'zh_info', type: 'info',
    label: 'Zone humide — Déclaration simplifiée recommandée',
    rubrique: 'Rubrique 3.3.1.0 · Code de l\'env.',
    organism: 'DDT(M) du département (pour information)',
    delay: '–',
    docs: [
      'Courrier de notification préalable à la DDT(M)',
      'Description sommaire du projet et des mesures de précaution',
    ],
  },
  zh_declaration: {
    id: 'zh_declaration', type: 'declaration',
    label: 'Déclaration IOTA – Zone humide',
    rubrique: 'Rubrique 3.3.1.0 · Code de l\'env.',
    organism: 'DDT(M) du département (service police de l\'eau)',
    delay: '1 à 2 mois',
    docs: [
      'Formulaire Cerfa n°13617 (Déclaration IOTA)',
      'Localisation précise de la zone humide (carte)',
      'Description des travaux et surface impactée',
      'Mesures d\'évitement, de réduction et de compensation',
      'Engagement de remise en état après travaux',
    ],
  },
  zh_autorisation: {
    id: 'zh_autorisation', type: 'autorisation',
    label: 'Autorisation préfectorale – Zone humide',
    rubrique: 'Rubrique 3.3.1.0 · Code de l\'env.',
    organism: 'Préfecture du département (instruction DDT)',
    delay: '6 à 18 mois',
    docs: [
      'Formulaire Cerfa n°13617 (Demande d\'autorisation IOTA)',
      'Délimitation précise de la zone humide (critères pédologiques et floristiques)',
      'Étude d\'incidences sur les zones humides',
      'Plan de compensation (ratio ≥ 2 pour 1 en surface)',
      'Mesures de suivi et de gestion post-travaux',
    ],
  },
  natura_ein: {
    id: 'natura_ein', type: 'ein',
    label: 'Évaluation des Incidences Natura 2000 (EIN)',
    rubrique: 'Art. L.414-4 Code env. · Directive Habitats/Oiseaux',
    organism: 'DDT(M) ou Préfecture du département',
    delay: '2 à 6 mois',
    docs: [
      'Formulaire simplifié d\'évaluation des incidences (Cerfa n°14734)',
      'Présentation du projet et de sa localisation vis-à-vis des zones N2000',
      'Description des espèces et habitats susceptibles d\'être affectés',
      'Analyse des incidences directes et indirectes',
      'Mesures d\'atténuation (évitement, réduction, compensation)',
      'Conclusion sur l\'absence d\'incidences significatives',
    ],
  },
  znieff1_info: {
    id: 'znieff1_info', type: 'info',
    label: 'ZNIEFF type I — Inventaire écologique préalable recommandé',
    rubrique: 'Inventaire ZNIEFF (non contraignant)',
    organism: 'DREAL (pour information) · CSRPN de la région',
    delay: '–',
    docs: [
      'Inventaire floristique et faunistique préliminaire',
      'Vérification de l\'absence d\'espèces protégées (flore, faune)',
      'Rapport d\'expertise écologique si espèces sensibles détectées',
    ],
  },
};

function determineProcedures(d, zones) {
  const travaux  = d.travaux || [];
  const details  = d.details || {};
  const surfHa   = parseFloat(d.surface_ha) || 0;
  const volHydro  = details.hydrocurage?.volume_m3 || 0;
  const volCurage = details.curage
    ? Math.round(surfHa * 10000 * (details.curage.pct_surface / 100) * (details.curage.prof_vase_cm / 100))
    : 0;
  const volTotal  = volHydro + volCurage;

  const hasZH      = zones.some(z => z.type === 'zh');
  const hasNatura  = zones.some(z => z.type === 'eco' && z.name.includes('Natura'));
  const hasZNIEFF1 = zones.some(z => z.type === 'eco' && z.name.includes('ZNIEFF type I'));

  const procs = [];

  // Rubrique 3.2.3.0 — Curage plan d'eau
  const hasCurage = travaux.includes('curage') || travaux.includes('hydrocurage');
  if (hasCurage && volTotal > 0) {
    if (volTotal >= 2000) {
      procs.push({ ...PROC_TEMPLATES.curage_autorisation,
        context: `Volume estimé : ${volTotal.toLocaleString('fr')} m³ — seuil d'autorisation ≥ 2 000 m³` });
    } else if (volTotal >= 400) {
      procs.push({ ...PROC_TEMPLATES.curage_declaration,
        context: `Volume estimé : ${volTotal.toLocaleString('fr')} m³ — seuil de déclaration 400–2 000 m³` });
    }
  }

  // Rubrique 3.3.1.0 — Zone humide
  if (hasZH) {
    const epSurf = (details.hydrocurage?.epandage_surface_m2 || 0) + (details.curage?.epandage_surface_m2 || 0);
    const impactHa = epSurf > 0 ? epSurf / 10000 : surfHa;
    if (impactHa >= 1) {
      procs.push({ ...PROC_TEMPLATES.zh_autorisation,
        context: `Surface concernée estimée : ${impactHa.toFixed(2)} ha — seuil d'autorisation ≥ 1 ha` });
    } else if (impactHa >= 0.1) {
      procs.push({ ...PROC_TEMPLATES.zh_declaration,
        context: `Surface concernée estimée : ${impactHa.toFixed(2)} ha — seuil de déclaration 0,1–1 ha` });
    } else {
      procs.push({ ...PROC_TEMPLATES.zh_info,
        context: `Surface concernée : ${(impactHa * 10000).toFixed(0)} m² (< 0,1 ha) — déclaration simplifiée recommandée` });
    }
  }

  // EIN Natura 2000
  if (hasNatura) {
    const zoneNames = zones.filter(z => z.name.includes('Natura'))
      .map(z => z.name + (z.siteName ? ` — ${z.siteName}` : '')).join(' · ');
    procs.push({ ...PROC_TEMPLATES.natura_ein, context: zoneNames });
  }

  // ZNIEFF type I
  if (hasZNIEFF1) {
    const z = zones.find(z => z.name.includes('ZNIEFF type I'));
    procs.push({ ...PROC_TEMPLATES.znieff1_info,
      context: z?.siteName ? `Zone : ${z.siteName}` : 'Inventaire préliminaire recommandé' });
  }

  return procs;
}

function renderDemarchesHtml(d, zones, procs, saved) {
  const statOpts = [
    ['a_preparer', '📝 À préparer'],
    ['en_cours',   '🔄 En cours'],
    ['depose',     '📬 Déposé'],
    ['obtenu',     '✅ Obtenu'],
    ['sans_objet', '➖ Sans objet'],
  ];

  let html = '';

  if (!zones.length && !procs.length) {
    html += '<div class="demarche-none">✅ Aucune zone réglementaire détectée — aucune formalité spécifique identifiée à ce stade.<br><small style="font-size:.73rem;color:var(--gray-500)">Ces données sont indicatives. Une vérification définitive est effectuée lors de la visite technique.</small></div>';
  } else if (!procs.length) {
    html += '<div class="demarche-none">✅ Zones détectées mais volumes/surfaces en-deçà des seuils réglementaires — aucune formalité obligatoire identifiée.</div>';
  } else {
    procs.forEach(p => {
      const sv = saved[p.id] || {};
      const sel = sv.statut || 'a_preparer';
      const docsChecked = sv.docs_checked || [];
      const opts = statOpts.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
      const docItems = p.docs.map((doc, i) => {
        const checked = docsChecked.includes(i);
        return `<li class="${checked ? 'checked' : ''}"><label>
          <input type="checkbox" class="proc-doc-cb" data-proc="${p.id}" data-idx="${i}"${checked ? ' checked' : ''}>
          ${esc(doc)}
        </label></li>`;
      }).join('');
      html += `
        <div class="demarche-card" data-proc="${p.id}">
          <div class="demarche-head">
            <span class="demarche-badge ${p.type}">${p.type === 'autorisation' ? 'Autorisation' : p.type === 'declaration' ? 'Déclaration' : p.type === 'ein' ? 'EIN' : 'Information'}</span>
            <span class="demarche-title">${esc(p.label)}</span>
            <select class="demarche-sel proc-statut-sel" data-proc="${p.id}">${opts}</select>
            <button class="btn-gen-doc" data-proc="${p.id}" title="Générer le document administratif">📄 Générer</button>
          </div>
          <div class="demarche-body">
            <div class="demarche-meta">${esc(p.rubrique)} · <strong>${esc(p.organism)}</strong>${p.delay !== '–' ? ` · Délai indicatif : ${esc(p.delay)}` : ''}</div>
            ${p.context ? `<div class="demarche-context">📊 ${esc(p.context)}</div>` : ''}
            <div class="demarche-docs">
              <div class="demarche-docs-lbl">Documents à préparer :</div>
              <ul>${docItems}</ul>
            </div>
            <textarea class="demarche-note-ta proc-note" data-proc="${p.id}" placeholder="Notes internes…" rows="2">${esc(sv.note || '')}</textarea>
          </div>
        </div>`;
    });
  }

  // Zones détectées summary
  if (zones.length) {
    html += `<div style="margin-top:.6rem;font-size:.73rem;color:var(--gray-500)">
      Zones détectées : ${zones.map(z => `${z.type === 'zh' ? '💧' : '🌿'} ${esc(z.name)}${z.siteName ? ` (${esc(z.siteName)})` : ''}`).join(' · ')}
    </div>`;
  }

  // Fiche de données
  html += `<div style="margin-top:1rem;border-top:1px solid var(--gray-200);padding-top:.9rem">
    <div class="demarche-docs-lbl" style="margin-bottom:.4rem">📋 Fiche de données pour le dossier</div>
    <div class="fiche-data" id="fiche-data">${buildFiche(d, zones, procs)}</div>
    <button class="btn-copy-fiche" id="btn-copy-fiche">📋 Copier</button>
  </div>`;

  return html;
}

function buildFiche(d, zones, procs) {
  const now = new Date().toLocaleDateString('fr-FR');
  const details = d.details || {};
  const lines = [
    `FICHE DE DONNÉES CHANTIER — VANDAELE MARCEL & FILS`,
    `Date : ${now}`,
    '',
    `DEMANDEUR`,
    `Nom : ${d.prenom || ''} ${d.nom || ''}`.trim(),
    `Profil : ${{ particulier:'Particulier', professionnel:'Professionnel', collectivite:'Collectivité', association:'Association', agriculteur:'Agriculteur' }[d.profil] || d.profil || '–'}`,
    `Téléphone : ${d.telephone || '–'}`,
    `Email : ${d.email || '–'}`,
    '',
    `LOCALISATION`,
    `Adresse : ${d.adresse || '–'}`,
  ];
  if (d.lat && d.lng) lines.push(`Coordonnées GPS : ${d.lat.toFixed(6)}° N, ${d.lng.toFixed(6)}° E`);
  lines.push('');
  lines.push('PLAN D\'EAU');
  if (d.surface_ha)   lines.push(`Surface : ${d.surface_ha} ha (${Math.round(d.surface_ha * 10000).toLocaleString('fr')} m²)`);
  if (d.perimetre_ml) lines.push(`Périmètre : ${d.perimetre_ml} ml`);
  lines.push('');
  lines.push('TRAVAUX ENVISAGÉS');
  if (details.hydrocurage) {
    lines.push(`Type : Hydrocurage par aspiration`);
    lines.push(`Volume de vase estimé : ${details.hydrocurage.volume_m3 || '–'} m³`);
    lines.push(`Épaisseur de vase : ${details.hydrocurage.epaisseur_cm || '–'} cm`);
    if (details.hydrocurage.destination_vase === 'sur-place') {
      lines.push(`Destination vase : Épandage sur terrain (${details.hydrocurage.nature_terrain || '–'}, à ${details.hydrocurage.distance_depot_m || '–'} m)`);
      if (details.hydrocurage.epandage_surface_m2) lines.push(`Surface épandage disponible : ${Math.round(details.hydrocurage.epandage_surface_m2).toLocaleString('fr')} m²`);
    } else {
      lines.push(`Destination vase : Évacuation par nos soins`);
    }
  }
  if (details.curage) {
    lines.push(`Type : Curage mécanique (drague / pelle amphibie)`);
    lines.push(`Profondeur de vase : ${details.curage.prof_vase_cm || '–'} cm`);
    lines.push(`Surface concernée : ${details.curage.pct_surface || '–'} %`);
    if (details.curage.epandage_surface_m2) lines.push(`Surface épandage disponible : ${Math.round(details.curage.epandage_surface_m2).toLocaleString('fr')} m²`);
  }
  if (details.faucardage) lines.push(`Type : Faucardage (${details.faucardage.pct_couverture || '–'} % de la surface)`);
  if (details.berges) lines.push(`Type : Défenses de berges — ${details.berges.longueur_ml || '–'} ml`);
  if (d.acces) lines.push(`Accès chantier : ${{ facile:'Facile', moyen:'Moyen', difficile:'Difficile' }[d.acces] || d.acces}`);
  if (d.infos_sup) { lines.push(''); lines.push('INFORMATIONS COMPLÉMENTAIRES'); lines.push(d.infos_sup); }
  if (zones.length) {
    lines.push('');
    lines.push('CONTRAINTES RÉGLEMENTAIRES IDENTIFIÉES');
    lines.push(`Zone humide (Loi sur l'eau) : ${zones.some(z => z.type === 'zh') ? 'Oui' : 'Non'}`);
    lines.push(`Natura 2000 : ${zones.some(z => z.name.includes('Natura')) ? 'Oui' : 'Non'}`);
    lines.push(`ZNIEFF : ${zones.some(z => z.name.includes('ZNIEFF')) ? 'Oui' : 'Non'}`);
    if (procs.length) {
      lines.push('');
      lines.push('DÉMARCHES NÉCESSAIRES');
      procs.forEach(p => lines.push(`- ${p.label}`));
    }
  }
  lines.push('');
  lines.push(`Estimation indicative : ${d.estimation_text || '–'}`);
  return lines.join('\n');
}

function initDemarchesListeners(d, procs, zones) {
  document.querySelectorAll('.btn-gen-doc').forEach(btn => {
    btn.addEventListener('click', () => {
      const procId = btn.dataset.proc;
      const proc   = procs.find(p => p.id === procId);
      if (!proc) return;
      openDocModal(d, proc, zones || []);
    });
  });

  // Statut dropdown
  document.querySelectorAll('.proc-statut-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const procId = sel.dataset.proc;
      db.collection('demandes').doc(d.id).update({
        [`demarches.${procId}.statut`]: sel.value,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(err => console.error('Demarche statut update:', err));
    });
  });

  // Document checkboxes
  document.querySelectorAll('.proc-doc-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const procId  = cb.dataset.proc;
      const idx     = parseInt(cb.dataset.idx);
      const li      = cb.closest('li');
      if (li) li.classList.toggle('checked', cb.checked);
      // Collect all checked indices for this proc
      const allCbs  = document.querySelectorAll(`.proc-doc-cb[data-proc="${procId}"]`);
      const checked = [...allCbs].filter(c => c.checked).map(c => parseInt(c.dataset.idx));
      db.collection('demandes').doc(d.id).update({
        [`demarches.${procId}.docs_checked`]: checked,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(err => console.error('Demarche docs update:', err));
    });
  });

  // Note textareas (debounced)
  const noteTimers = {};
  document.querySelectorAll('.proc-note').forEach(ta => {
    ta.addEventListener('input', () => {
      const procId = ta.dataset.proc;
      clearTimeout(noteTimers[procId]);
      noteTimers[procId] = setTimeout(() => {
        db.collection('demandes').doc(d.id).update({
          [`demarches.${procId}.note`]: ta.value,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.error('Demarche note update:', err));
      }, 900);
    });
  });

  // Copy fiche
  document.getElementById('btn-copy-fiche')?.addEventListener('click', () => {
    const text = document.getElementById('fiche-data')?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-fiche');
      if (btn) { btn.textContent = '✅ Copié !'; setTimeout(() => { btn.textContent = '📋 Copier'; }, 2000); }
    }).catch(() => {});
  });
}

// ── GÉNÉRATION DE DOCUMENTS ADMINISTRATIFS ───────────────────

function _docName(d) { return `${(d.prenom||'').trim()} ${(d.nom||'').trim()}`.trim() || '– nom non précisé –'; }
function _docDate()  { return new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}); }
function _docProfil(d) {
  return {particulier:'Particulier',professionnel:'Professionnel / exploitant',collectivite:'Collectivité territoriale',association:'Association',agriculteur:'Agriculteur / exploitant agricole'}[d.profil] || 'Particulier';
}
function _docSurf(d) {
  if (!d.surface_ha) return '<span class="adm-doc-placeholder">[surface à préciser]</span>';
  const ha = parseFloat(d.surface_ha);
  return `${ha} ha (environ ${Math.round(ha*10000).toLocaleString('fr')} m²)`;
}
function _ph(label) { return `<span class="adm-doc-placeholder">[${label}]</span>`; }
function _docTable(rows) {
  return '<table class="adm-doc-tbl">' + rows.map(([k,v]) =>
    `<tr><td class="adm-doc-tbl-k">${k}</td><td>${v}</td></tr>`).join('') + '</table>';
}
function _letterWrap({ from, to, city, objet, body, pj = [] }) {
  const pjHtml = pj.length ? `<div class="adm-doc-pj"><strong>Pièces jointes :</strong><ul>${pj.map(p=>`<li>${p}</li>`).join('')}</ul></div>` : '';
  return `<div class="adm-doc-page">
  <div class="adm-doc-columns">
    <div class="adm-doc-from">${from}</div>
    <div class="adm-doc-to"><div class="adm-doc-to-box">${to}</div></div>
  </div>
  <div class="adm-doc-dateline">${esc(city)}, le ${_docDate()}</div>
  <div class="adm-doc-objet"><strong>Objet :</strong> ${objet}</div>
  <div class="adm-doc-content">${body}</div>
  ${pjHtml}
</div>`;
}

function _genIOTA(d, type) {
  const details   = d.details || {};
  const name      = _docName(d);
  const isAuth    = type === 'autorisation';
  const surfHa    = parseFloat(d.surface_ha || 0);
  const volHydro  = parseInt(details.hydrocurage?.volume_m3 || 0);
  const profCm    = parseInt(details.curage?.prof_vase_cm || 0);
  const pctSurf   = parseInt(details.curage?.pct_surface || 100);
  const volCurage = details.curage ? Math.round(surfHa * 10000 * (pctSurf/100) * (profCm/100)) : 0;
  const volTotal  = volHydro + volCurage;
  const destHydro = details.hydrocurage?.destination_vase === 'sur-place'
    ? `Épandage sur terrain adjacent (à ${details.hydrocurage.distance_depot_m || _ph('distance m')} m du plan d'eau ; surface disponible : ${details.hydrocurage.epandage_surface_m2 ? Math.round(details.hydrocurage.epandage_surface_m2).toLocaleString('fr')+' m²' : _ph('surface m²')})`
    : 'Évacuation et valorisation agricole par transporteur agréé';

  const body = `<p>Monsieur/Madame le ${isAuth ? 'Préfet' : 'Directeur'},</p>
<p>Par la présente, j'ai l'honneur de vous adresser ${isAuth ? 'une demande d\'autorisation' : 'une déclaration'} au titre des articles L.214-1 et R.214-1 et suivants du Code de l'environnement, pour des travaux d'entretien et de curage d'un plan d'eau privé.</p>
<h4>I. Identification du demandeur</h4>
${_docTable([['Nom / Raison sociale',esc(name)],['Qualité',_docProfil(d)],['Adresse',esc(d.adresse||'–')],['Téléphone',esc(d.telephone||'–')],['Email',esc(d.email||'–')]])}
<h4>II. Localisation du projet</h4>
${_docTable([['Commune / lieu-dit',esc(d.adresse||_ph('commune'))],['Département','Pas-de-Calais (62)'],...(d.lat&&d.lng?[['Coordonnées GPS (WGS84)',`${d.lat.toFixed(6)}° N · ${d.lng.toFixed(6)}° E`]]:[])])}
<p>Références cadastrales : ${_ph('Section __ N° __ – extrait cadastral joint')}</p>
<h4>III. Description du plan d'eau</h4>
${_docTable([['Surface',_docSurf(d)],...(d.perimetre_ml?[['Périmètre',`${d.perimetre_ml} ml`]]:[]),['Nature',_ph('étang / mare / bassin – préciser')],['Mode d\'alimentation',_ph('nappe / ruisseau / fossé')],['Ouvrage de vidange',_ph('moine / vanne – préciser')]])}
<h4>IV. Description des travaux envisagés</h4>
${details.hydrocurage ? `<p><strong>Hydrocurage par aspiration :</strong></p>${_docTable([['Volume de sédiments',`${volHydro.toLocaleString('fr')} m³`],['Épaisseur de vase',`${details.hydrocurage.epaisseur_cm||_ph('cm')} cm`],['Destination des sédiments',destHydro]])}` : ''}
${details.curage ? `<p><strong>Curage mécanique :</strong></p>${_docTable([['Volume de sédiments',`${volCurage.toLocaleString('fr')} m³`],['Profondeur de vase',`${details.curage.prof_vase_cm||_ph('cm')} cm`],['Surface concernée',`${details.curage.pct_surface||_ph('%')} % du plan d'eau`]])}` : ''}
<p><strong>Volume total de sédiments à extraire : ${volTotal.toLocaleString('fr')} m³</strong><br>
Ce volume ${isAuth ? '≥ 2 000 m³ justifie une demande d\'autorisation' : 'compris entre 400 et 2 000 m³ relève de la procédure de déclaration'} au titre de la rubrique 3.2.3.0 de la nomenclature annexée à l'art. R.214-1 du Code de l'environnement.</p>
<h4>V. Calendrier prévisionnel</h4>
<p>Début des travaux : ${_ph('mois et année')} – durée estimée : ${_ph('nombre de jours ouvrés')}.<br>Les interventions seront planifiées hors périodes biologiques sensibles (hors frai printanier mars–juin, hors nidification mars–août).</p>
<h4>VI. Mesures d'évitement, de réduction et de compensation (ERC)</h4>
<ul>
  <li>Intervention programmée hors périodes biologiques sensibles</li>
  <li>Filtre géotextile ou batardeau anti-turbidité en aval si rejet dans un cours d'eau récepteur</li>
  <li>Analyse physico-chimique préalable des sédiments si nécessaire (métaux lourds, HAP, PCB – circulaire 04/07/2008)</li>
  <li>Épandage ou évacuation des sédiments conformément à la réglementation</li>
  <li>Remise en eau progressive et contrôlée à l'issue des travaux</li>
  <li>Travaux réalisés par ETS Vandaele Marcel &amp; Fils, spécialiste en travaux aquatiques depuis 1953</li>
</ul>
${isAuth ? '<h4>VII. Éléments d\'incidence sur l\'eau et les milieux aquatiques</h4><p>Voir notice d\'incidence jointe (rapport technique distinct).</p>' : ''}
<p>${isAuth ? 'Je sollicite l\'autorisation préfectorale nécessaire à la réalisation de ces travaux.' : 'Je vous saurais gré de bien vouloir me délivrer le récépissé de déclaration, qui me permettra d\'engager les travaux à l\'expiration du délai réglementaire d\'opposition.'}</p>
<p>Je reste à votre entière disposition pour tout renseignement complémentaire.</p>
<p>Je vous prie d'agréer, Monsieur/Madame le ${isAuth ? 'Préfet' : 'Directeur'}, l'expression de ma considération distinguée.</p>
<div class="adm-doc-sig">
  <div class="adm-doc-sig-lines">
    <p>${esc(name)}</p>
    <p style="color:#666;font-size:.88em">À __________________, le __________________</p>
    <p style="margin-top:2rem;font-style:italic">Signature :</p>
    <div style="height:3rem;border-bottom:1px solid #aaa;width:180px;margin-top:.3rem"></div>
  </div>
</div>`;

  return _letterWrap({
    from: `<strong>${esc(name)}</strong><br>${esc(d.adresse||'–')}<br>Tél. : ${esc(d.telephone||'–')}<br>${esc(d.email||'–')}`,
    to: isAuth
      ? `<strong>M./Mme le Préfet du Pas-de-Calais</strong><br>Préfecture du Pas-de-Calais<br>2 rue Ferdinand Buisson<br>62020 Arras Cedex<br><small style="color:#666"><em>(à adapter selon le département du site)</em></small>`
      : `<strong>M./Mme le Directeur Départemental</strong><br>Direction Départementale des Territoires<br>du Pas-de-Calais (DDT 62)<br>Service Police de l'Eau<br>1 rue de Verdun – BP 2018<br>62020 Arras Cedex`,
    city: 'Tortefontaine',
    objet: isAuth
      ? 'Demande d\'autorisation – Loi sur l\'eau – Rubrique 3.2.3.0 – Travaux de curage de plan d\'eau'
      : 'Déclaration – Loi sur l\'eau – Rubrique 3.2.3.0 – Travaux d\'entretien de plan d\'eau',
    body,
    pj: isAuth
      ? ['Plan de situation au 1/25 000 (IGN)','Plan coté du plan d\'eau','Étude d\'incidences sur l\'eau et les milieux aquatiques','Note de calcul des volumes de sédiments extraits','Analyse physico-chimique des sédiments (si disponible)','Extrait cadastral','Photos du site']
      : ['Plan de situation au 1/25 000 (IGN)','Plan du plan d\'eau','Description des travaux','Extrait cadastral'],
  });
}

function _genZH(d, type, zones) {
  const details   = d.details || {};
  const name      = _docName(d);
  const isAuth    = type === 'autorisation';
  const surfHa    = parseFloat(d.surface_ha || 0);
  const epSurf    = (details.hydrocurage?.epandage_surface_m2||0) + (details.curage?.epandage_surface_m2||0);
  const impactHa  = (epSurf > 0 ? epSurf/10000 : surfHa).toFixed(2);
  const zhZone    = zones.find(z => z.type === 'zh');
  const zhName    = zhZone?.siteName ? esc(zhZone.siteName) : _ph('nom de la zone humide – consulter cartographie DDT');

  const body = `<p>Monsieur/Madame le ${isAuth ? 'Préfet' : 'Directeur'},</p>
<p>Par la présente, j'ai l'honneur de vous adresser ${isAuth ? 'une demande d\'autorisation' : 'une déclaration'} au titre des articles L.214-1 et R.214-1 du Code de l'environnement, relatifs aux travaux impactant une zone humide.</p>
<h4>I. Identification du demandeur</h4>
${_docTable([['Nom / Raison sociale',esc(name)],['Qualité',_docProfil(d)],['Adresse',esc(d.adresse||'–')],['Téléphone',esc(d.telephone||'–')]])}
<h4>II. Localisation et identification de la zone humide</h4>
${_docTable([['Commune',esc(d.adresse||_ph('commune'))],['Zone humide concernée',zhName],...(d.lat&&d.lng?[['GPS (WGS84)',`${d.lat.toFixed(6)}° N · ${d.lng.toFixed(6)}° E`]]:[])])}
<p>La délimitation précise de la zone humide a été / sera réalisée par ${_ph('bureau d\'études agréé')} selon l'arrêté du 24 juin 2008 (critères pédologiques et floristiques).</p>
<h4>III. Description du projet et de son impact</h4>
${_docTable([['Nature des travaux','Curage / hydrocurage – entretien de plan d\'eau privé'],['Surface du plan d\'eau',_docSurf(d)],['Surface de zone humide impactée estimée',`${impactHa} ha`],['Rubrique IOTA',isAuth ? 'Rubrique 3.3.1.0 – Autorisation (≥ 1 ha)' : 'Rubrique 3.3.1.0 – Déclaration (0,1 à 1 ha)']])}
<h4>IV. Mesures d'évitement, de réduction et de compensation (ERC)</h4>
<p><strong>Évitement :</strong> Limitation de l'emprise des travaux au strict nécessaire pour l'entretien du plan d'eau, sans modification définitive du fonctionnement hydrologique de la zone humide.</p>
<p><strong>Réduction :</strong></p>
<ul>
  <li>Travaux hors périodes biologiques sensibles</li>
  <li>Absence de drainage ou d'assèchement définitif de la zone humide</li>
  <li>Remise en état immédiate des berges et des abords après les travaux</li>
  <li>Interdiction de dépôt de matériaux extérieurs non inertes sur la zone humide</li>
</ul>
${isAuth ? `<p><strong>Compensation :</strong> En cas de destruction avérée de zone humide, une compensation à hauteur d'au moins 200 % de la surface détruite est proposée conformément à l'art. L.163-1 du Code de l'environnement (surface compensatoire proposée : ${_ph('X ha – à définir avec le service instructeur')}).</p>` : ''}
<h4>V. Engagement du demandeur</h4>
<p>Je m'engage à respecter l'ensemble des prescriptions légales applicables et à informer le service instructeur de toute modification du projet avant engagement des travaux.</p>
<p>${isAuth ? 'Je sollicite l\'autorisation préfectorale nécessaire à la réalisation de ces travaux.' : 'Je vous saurais gré de bien vouloir me délivrer le récépissé de déclaration correspondant.'}</p>
<p>Je vous prie d'agréer, Monsieur/Madame le ${isAuth ? 'Préfet' : 'Directeur'}, l'expression de ma considération distinguée.</p>
<div class="adm-doc-sig">
  <div class="adm-doc-sig-lines">
    <p>${esc(name)}</p>
    <p style="color:#666;font-size:.88em">À __________________, le __________________</p>
    <p style="margin-top:2rem;font-style:italic">Signature :</p>
    <div style="height:3rem;border-bottom:1px solid #aaa;width:180px;margin-top:.3rem"></div>
  </div>
</div>`;

  return _letterWrap({
    from: `<strong>${esc(name)}</strong><br>${esc(d.adresse||'–')}<br>Tél. : ${esc(d.telephone||'–')}`,
    to: isAuth
      ? `<strong>M./Mme le Préfet du Pas-de-Calais</strong><br>Préfecture du Pas-de-Calais<br>2 rue Ferdinand Buisson<br>62020 Arras Cedex`
      : `<strong>M./Mme le Directeur Départemental</strong><br>Direction Départementale des Territoires<br>du Pas-de-Calais (DDT 62)<br>Service Police de l'Eau<br>1 rue de Verdun<br>62020 Arras Cedex`,
    city: 'Tortefontaine',
    objet: isAuth
      ? 'Demande d\'autorisation – Loi sur l\'eau – Rubrique 3.3.1.0 – Zone humide'
      : 'Déclaration – Loi sur l\'eau – Rubrique 3.3.1.0 – Zone humide',
    body,
    pj: ['Plan de situation au 1/25 000','Rapport de délimitation de la zone humide (critères pédologiques et floristiques)','Plans généraux des travaux','Description des mesures ERC',...(isAuth?['Plan de compensation proposé']:[])]
  });
}

function _genZHInfo(d) {
  const name = _docName(d);
  return _letterWrap({
    from: `<strong>${esc(name)}</strong><br>${esc(d.adresse||'–')}<br>Tél. : ${esc(d.telephone||'–')}`,
    to: `<strong>M./Mme le Directeur Départemental</strong><br>Direction Départementale des Territoires<br>du Pas-de-Calais (DDT 62)<br>Service Police de l'Eau<br>62020 Arras Cedex`,
    city: 'Tortefontaine',
    objet: 'Information préalable – Travaux de curage en zone humide (surface impactée < 0,1 ha)',
    body: `<p>Monsieur/Madame le Directeur,</p>
<p>Par la présente, je vous informe de travaux d'entretien que je prévois de réaliser sur un plan d'eau privé situé en zone humide, dont la surface d'impact est estimée inférieure au seuil de déclaration de 1 000 m² (0,1 ha) prévu par la rubrique 3.3.1.0 de la nomenclature IOTA.</p>
${_docTable([['Demandeur',esc(name)],['Localisation',esc(d.adresse||'–')],['Nature des travaux','Curage / hydrocurage – entretien courant de plan d\'eau'],['Surface du plan d\'eau',_docSurf(d)],['Surface de zone humide impactée estimée','< 0,1 ha (en-deçà du seuil de déclaration)']])}
<p>Ces travaux seront réalisés avec toutes les précautions nécessaires pour préserver la zone humide environnante :</p>
<ul>
  <li>Intervention hors périodes biologiques sensibles</li>
  <li>Absence de modification définitive du fonctionnement hydrologique</li>
  <li>Remise en état immédiate des berges après travaux</li>
</ul>
<p>Je reste à votre entière disposition pour tout renseignement complémentaire.</p>
<p>Je vous prie d'agréer, Monsieur/Madame le Directeur, l'expression de ma considération distinguée.</p>
<div class="adm-doc-sig"><div class="adm-doc-sig-lines"><p>${esc(name)}</p><p style="color:#666;font-size:.88em">À __________________, le __________________</p></div></div>`,
    pj: ['Description sommaire du projet','Localisation du plan d\'eau (extrait IGN)'],
  });
}

function _genEIN(d, zones) {
  const details   = d.details || {};
  const name      = _docName(d);
  const natZones  = zones.filter(z => z.name && z.name.includes('Natura'));
  const sites     = natZones.map(z => z.siteName ? esc(z.siteName) : esc(z.name)).join(', ') || _ph('nom du ou des sites Natura 2000 – consulter natura2000.fr');
  const volHydro  = parseInt(details.hydrocurage?.volume_m3||0);
  const surfHa    = parseFloat(d.surface_ha||0);

  return `<div class="adm-doc-page">
<div style="border-bottom:2px solid #333;padding-bottom:.65rem;margin-bottom:1.2rem;display:flex;justify-content:space-between;align-items:flex-end">
  <div>
    <div style="font-size:1rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Évaluation des Incidences Natura 2000</div>
    <div style="font-size:.9rem;color:#444">Formulaire simplifié — Art. L.414-4 du Code de l'environnement</div>
  </div>
  <div style="text-align:right;font-size:.9rem;color:#666">Date : ${_docDate()}</div>
</div>
<div class="adm-doc-content">
<h4>1. Identification du demandeur et du maître d'œuvre</h4>
${_docTable([['Demandeur',esc(name)],['Qualité',_docProfil(d)],['Adresse',esc(d.adresse||'–')],['Téléphone',esc(d.telephone||'–')],['Email',esc(d.email||'–')],['Maître d\'œuvre','ETS Vandaele Marcel & Fils – Tortefontaine (62140) – Tél. 06 32 44 11 17']])}
<h4>2. Présentation du projet</h4>
${_docTable([['Nature du projet','Travaux d\'entretien et de curage d\'un plan d\'eau privé'],['Localisation',esc(d.adresse||'–')],...(d.lat&&d.lng?[['Coordonnées GPS',`${d.lat.toFixed(6)}° N, ${d.lng.toFixed(6)}° E`]]:[])])}
<p>Les travaux consistent en ${details.hydrocurage ? `un hydrocurage par aspiration (volume estimé : ${volHydro.toLocaleString('fr')} m³)` : 'un curage mécanique'} d'un plan d'eau de ${surfHa} ha, dans le but de restaurer la profondeur et la qualité de l'eau.</p>
<h4>3. Localisation par rapport aux sites Natura 2000 identifiés</h4>
${_docTable([['Sites Natura 2000 concernés',sites],['Distance au site le plus proche',_ph('X m – mesurer sur geoportail.gouv.fr')],['Connexion hydrologique',_ph('décrire si le plan d\'eau communique avec un cours d\'eau du réseau Natura')]])}
<h4>4. Caractéristiques des habitats et espèces visés par le FSD</h4>
<p>Le ou les sites Natura 2000 ont été désignés pour les habitats et espèces suivants (à vérifier sur <a href="https://natura2000.fr" style="color:inherit">natura2000.fr</a>) :</p>
<p style="background:#f5f5f5;padding:.5rem .75rem;border-radius:4px;font-size:.9em">${_ph('liste des espèces et habitats d\'intérêt communautaire du FSD – à compléter en consultant la fiche du site sur natura2000.fr')}</p>
<h4>5. Évaluation des incidences</h4>
<p><strong>Incidences directes :</strong> Les travaux se déroulent exclusivement sur le plan d'eau privé. Les incidences directes sur les habitats naturels ou espèces Natura 2000 sont considérées comme faibles à nulles : aucune intervention sur les habitats terrestres du site, travaux de courte durée, absence de modification définitive du fonctionnement hydrologique.</p>
<p><strong>Incidences indirectes :</strong> Une mise en suspension temporaire de sédiments est possible lors du curage. Mesures de réduction prévues : filtre anti-turbidité, intervention en période de bas débit, absence de rejet direct dans le milieu naturel.</p>
<p><strong>Incidences cumulées :</strong> Aucun autre projet connu à proximité susceptible de générer des incidences cumulées.</p>
<h4>6. Mesures d'atténuation</h4>
<ul>
  <li>Travaux programmés hors nidification (mars–août) et hors frai printanier</li>
  <li>Dispositifs anti-turbidité en aval si connexion hydraulique avec le site Natura 2000</li>
  <li>Absence de rejet direct de sédiments dans tout cours d'eau</li>
  <li>Surveillance de la qualité de l'eau en aval pendant les travaux si pertinent</li>
</ul>
<h4>7. Conclusion</h4>
<div class="adm-doc-conclusion-ok">
  <strong>Le projet de curage du plan d'eau ne porte pas atteinte à l'état de conservation des habitats naturels et des espèces ayant justifié la désignation du ou des sites Natura 2000 identifiés.</strong><br>
  Les incidences résiduelles, après application des mesures d'atténuation, sont considérées comme non significatives au sens de l'art. L.414-4 du Code de l'environnement.
</div>
<div class="adm-doc-sig" style="margin-top:1.8rem">
  <p>Je soussigné(e) <strong>${esc(name)}</strong> atteste que les informations contenues dans le présent formulaire sont exactes et complètes.</p>
  <div class="adm-doc-sig-lines">
    <p style="color:#666;font-size:.88em">À __________________, le __________________</p>
    <p style="margin-top:2rem;font-style:italic">Signature :</p>
    <div style="height:3rem;border-bottom:1px solid #aaa;width:180px;margin-top:.3rem"></div>
  </div>
</div>
</div>
</div>`;
}

function _genZNIEFF(d, zones) {
  const name    = _docName(d);
  const zniZone = zones.find(z => z.name && z.name.includes('ZNIEFF'));
  const zoneName = zniZone?.siteName ? esc(zniZone.siteName) : _ph('nom de la zone ZNIEFF – consulter inpn.mnhn.fr');

  return _letterWrap({
    from: `<strong>${esc(name)}</strong><br>${esc(d.adresse||'–')}<br>Tél. : ${esc(d.telephone||'–')}`,
    to: `<strong>M./Mme le Directeur Régional</strong><br>DREAL Hauts-de-France<br>Service Nature, Sites et Paysages<br>44 rue de Tournai – BP 259<br>59019 Lille Cedex`,
    city: 'Tortefontaine',
    objet: `Demande d'avis préalable informel – Travaux en ZNIEFF type I – ${zoneName}`,
    body: `<p>Monsieur/Madame le Directeur Régional,</p>
<p>Par la présente, je sollicite votre avis préalable informel concernant des travaux d'entretien et de curage d'un plan d'eau privé situé dans le périmètre ou à proximité d'une ZNIEFF de type I : <strong>${zoneName}</strong>.</p>
<p>Bien que la ZNIEFF constitue un inventaire scientifique sans obligation légale directe, sa présence témoigne d'une valeur biologique élevée que nous souhaitons pleinement prendre en compte dans notre projet.</p>
${_docTable([['Demandeur',esc(name)],['Maître d\'œuvre','ETS Vandaele Marcel & Fils – Tortefontaine (62140)'],['Localisation du chantier',esc(d.adresse||'–')],...(d.lat&&d.lng?[['GPS',`${d.lat.toFixed(6)}° N, ${d.lng.toFixed(6)}° E`]]:[]),['ZNIEFF concernée',zoneName],['Nature des travaux','Curage / hydrocurage de plan d\'eau privé – entretien courant'],['Surface du plan d\'eau',_docSurf(d)]])}
<p>Nous vous prions de bien vouloir :</p>
<ul>
  <li>Nous indiquer si les espèces ou habitats visés par l'inventaire ZNIEFF sont susceptibles d'être présents sur la zone de travaux</li>
  <li>Nous préciser si une étude faune-flore préalable vous semble nécessaire</li>
  <li>Nous communiquer tout conseil opérationnel pour minimiser l'impact sur la biodiversité de la zone</li>
</ul>
<p>Nous nous engageons à respecter toutes les préconisations que vous pourriez formuler et à programmer les travaux en dehors des périodes biologiques sensibles.</p>
<p>Je vous prie d'agréer, Monsieur/Madame le Directeur Régional, l'expression de ma considération distinguée.</p>
<div class="adm-doc-sig"><div class="adm-doc-sig-lines"><p>${esc(name)}</p><p style="color:#666;font-size:.88em">À __________________, le __________________</p><p style="margin-top:2rem;font-style:italic">Signature :</p><div style="height:3rem;border-bottom:1px solid #aaa;width:180px;margin-top:.3rem"></div></div></div>`,
    pj: ['Localisation du plan d\'eau (extrait IGN 1/25 000)','Description sommaire des travaux envisagés'],
  });
}

const DOCUMENT_GENERATORS = {
  curage_declaration:  (d, _p, zones) => _genIOTA(d, 'declaration'),
  curage_autorisation: (d, _p, zones) => _genIOTA(d, 'autorisation'),
  zh_info:             (d, _p, zones) => _genZHInfo(d),
  zh_declaration:      (d, _p, zones) => _genZH(d, 'declaration', zones),
  zh_autorisation:     (d, _p, zones) => _genZH(d, 'autorisation', zones),
  natura_ein:          (d, _p, zones) => _genEIN(d, zones),
  znieff1_info:        (d, _p, zones) => _genZNIEFF(d, zones),
};

function openDocModal(d, proc, zones) {
  const gen = DOCUMENT_GENERATORS[proc.id];
  if (!gen) return;
  const html = gen(d, proc, zones);
  const title = document.getElementById('doc-modal-title');
  if (title) title.textContent = proc.label;
  document.getElementById('doc-modal-body').innerHTML = html;
  document.getElementById('doc-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

document.getElementById('doc-modal-close').addEventListener('click', () => {
  document.getElementById('doc-modal').hidden = true;
  document.body.style.overflow = '';
});

document.getElementById('doc-modal').addEventListener('click', e => {
  if (e.target.classList.contains('doc-modal-overlay')) {
    document.getElementById('doc-modal').hidden = true;
    document.body.style.overflow = '';
  }
});

document.getElementById('doc-modal-print').addEventListener('click', () => {
  const body = document.getElementById('doc-modal-body').innerHTML;
  const win  = window.open('', '_blank', 'width=900,height=1000');
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Document administratif</title>
<style>
  body{font-family:'Times New Roman',Times,serif;font-size:11pt;color:#111;margin:0;padding:2cm 2.5cm}
  h4{font-size:11pt;font-weight:700;margin:1rem 0 .35rem;border-bottom:1px solid #bbb;padding-bottom:.18rem;text-transform:uppercase;letter-spacing:.03em}
  p{margin:.45rem 0;line-height:1.65}
  ul{margin:.35rem 0;padding-left:1.4rem}
  li{margin-bottom:.2rem}
  table{width:100%;border-collapse:collapse;margin:.4rem 0 .8rem;font-size:10.5pt}
  td{padding:.28rem .55rem;border:1px solid #bbb;vertical-align:top}
  .adm-doc-tbl-k{background:#f5f5f5;font-weight:600;width:38%}
  .adm-doc-lh{margin-bottom:1.8rem}
  .adm-doc-columns{display:flex;justify-content:space-between;gap:1rem;margin-bottom:1.8rem}
  .adm-doc-from{flex:1;font-size:10.5pt}
  .adm-doc-to{text-align:right;flex:1;font-size:10.5pt}
  .adm-doc-to-box{display:inline-block;text-align:left}
  .adm-doc-dateline{margin-bottom:1.5rem;font-size:10.5pt}
  .adm-doc-objet{margin-bottom:1.2rem;background:#f5f5f5;padding:.4rem .65rem;font-size:10.5pt}
  .adm-doc-sig{margin-top:2.5rem;font-size:10.5pt}
  .adm-doc-pj{margin-top:1.5rem;padding-top:.6rem;border-top:1px solid #ccc;font-size:10pt}
  .adm-doc-pj ul{margin:.3rem 0 0 1.2rem}
  .adm-doc-conclusion-ok{background:#f0fdf4;border:1.5px solid #86efac;border-radius:5px;padding:.6rem .9rem;margin:.8rem 0;font-size:10.5pt}
  .adm-doc-placeholder{background:#fef9c3;border:1px dashed #ca8a04;border-radius:3px;padding:.02rem .28rem;color:#78350f;font-family:monospace;font-size:9.5pt}
  a{color:inherit}
  @page{margin:2cm 2.5cm}
</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
});
