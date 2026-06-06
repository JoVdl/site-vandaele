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

document.getElementById('btn-refresh')?.addEventListener('click', startListener);

// ── GRILLE TARIFAIRE ─────────────────────────────────────────
const TARIFS_DEFAULTS = {
  mobilisation: { min: 800, max: 2000 },
  hydrocurage: {
    facile:    { min: 18, max: 30 },
    moyen:     { min: 28, max: 48 },
    difficile: { min: 40, max: 70 },
  },
  curage: {
    facile:    { min: 12, max: 22 },
    moyen:     { min: 18, max: 32 },
    difficile: { min: 28, max: 50 },
    evacuation: { min: 5, max: 10 },
  },
  faucardage: {
    facile:    { min: 700,  max: 1200 },
    moyen:     { min: 900,  max: 1600 },
    difficile: { min: 1300, max: 2200 },
    jussie: 1.4,
  },
  berges: {
    enrochement: { min: 150, max: 280 },
    palplanche:  { min: 200, max: 400 },
    gabion:      { min: 120, max: 220 },
    vegetal:     { min: 50,  max: 100 },
    conseil:     { min: 150, max: 280 },
  },
  'broyage-forestier': {
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

  let tarifs = JSON.parse(JSON.stringify(TARIFS_DEFAULTS));
  try {
    const snap = await db.collection('config').doc('tarifs').get();
    if (snap.exists) tarifs = snap.data();
  } catch (e) {
    console.error('[Firebase] Tarifs load failed:', e.code, e.message);
  }

  const row = (field, label, unit, val) => `
    <tr>
      <td class="tt-label">${label}</td>
      <td class="tt-unit">${unit}</td>
      <td><input type="number" class="tt-input" data-field="${field}.min" value="${val.min}" min="0" step="1"></td>
      <td><input type="number" class="tt-input" data-field="${field}.max" value="${val.max}" min="0" step="1"></td>
    </tr>`;

  const sec = (label) =>
    `<tr class="tt-section"><td colspan="4">${label}</td></tr>`;

  panel.innerHTML = `
    <div class="tarifs-panel-header">
      <div>
        <h2>⚙️ Grille tarifaire</h2>
        <p>Modifiez les fourchettes de prix utilisées pour les estimations en ligne. Les changements s'appliquent immédiatement après sauvegarde.</p>
      </div>
      <button id="btn-tarifs-save" class="btn-tarifs-save">💾 Sauvegarder</button>
    </div>

    <div class="coeff-bar">
      <span class="coeff-label">Ajustement global</span>
      <input type="range" id="coeff-slider" min="-50" max="100" value="0" step="1" class="coeff-slider">
      <span class="coeff-sign" id="coeff-sign">+</span>
      <input type="number" id="coeff-pct" value="0" min="-50" max="100" step="1" class="coeff-input">
      <span class="coeff-unit">%</span>
      <button id="coeff-apply" class="btn-coeff-apply">Appliquer</button>
      <button id="coeff-reset" class="btn-coeff-reset">Réinitialiser</button>
    </div>

    <table class="tarifs-table">
      <thead>
        <tr>
          <th>Prestation</th>
          <th>Unité</th>
          <th style="text-align:center">Min (€)</th>
          <th style="text-align:center">Max (€)</th>
        </tr>
      </thead>
      <tbody>
        ${sec('🚛 Déplacement / Mobilisation')}
        ${row('mobilisation', 'Mobilisation engin', '€ forfait', tarifs.mobilisation)}

        ${sec('💧 Hydrocurage')}
        ${row('hydrocurage.facile',    'Accès facile',    '€ / m³', tarifs.hydrocurage.facile)}
        ${row('hydrocurage.moyen',     'Accès moyen',     '€ / m³', tarifs.hydrocurage.moyen)}
        ${row('hydrocurage.difficile', 'Accès difficile', '€ / m³', tarifs.hydrocurage.difficile)}

        ${sec('🚜 Curage mécanique')}
        ${row('curage.facile',    'Accès facile',    '€ / m³', tarifs.curage.facile)}
        ${row('curage.moyen',     'Accès moyen',     '€ / m³', tarifs.curage.moyen)}
        ${row('curage.difficile', 'Accès difficile', '€ / m³', tarifs.curage.difficile)}
        ${row('curage.evacuation', 'Supplément évacuation vase', '€ / m³', tarifs.curage.evacuation)}

        ${sec('🌿 Faucardage')}
        ${row('faucardage.facile',    'Accès facile',    '€ / ha', tarifs.faucardage.facile)}
        ${row('faucardage.moyen',     'Accès moyen',     '€ / ha', tarifs.faucardage.moyen)}
        ${row('faucardage.difficile', 'Accès difficile', '€ / ha', tarifs.faucardage.difficile)}
        <tr>
          <td class="tt-label">Majoration jussie</td>
          <td class="tt-unit">coefficient ×</td>
          <td colspan="2" style="text-align:center">
            <input type="number" class="tt-input" data-field="faucardage.jussie"
              value="${tarifs.faucardage.jussie}" min="1" max="5" step="0.05"
              style="width:90px;margin:0 auto">
          </td>
        </tr>

        ${sec('🪨 Défenses de berges')}
        ${row('berges.enrochement', 'Enrochement',    '€ / ml', tarifs.berges.enrochement)}
        ${row('berges.palplanche',  'Palplanches',    '€ / ml', tarifs.berges.palplanche)}
        ${row('berges.gabion',      'Gabions',        '€ / ml', tarifs.berges.gabion)}
        ${row('berges.vegetal',     'Génie végétal',  '€ / ml', tarifs.berges.vegetal)}
        ${row('berges.conseil',     'À définir',      '€ / ml', tarifs.berges.conseil)}

        ${sec('🌲 Broyage forestier')}
        ${row('broyage-forestier.legere',  'Végétation légère',  '€ / ha', tarifs['broyage-forestier'].legere)}
        ${row('broyage-forestier.moyenne', 'Végétation moyenne', '€ / ha', tarifs['broyage-forestier'].moyenne)}
        ${row('broyage-forestier.dense',   'Végétation dense',   '€ / ha', tarifs['broyage-forestier'].dense)}

        ${sec('🌾 Broyage roseaux — sans ramassage')}
        ${row('broyage-roseaux.sans.facile',    'Accès facile',    '€ / ha', tarifs['broyage-roseaux'].sans.facile)}
        ${row('broyage-roseaux.sans.moyen',     'Accès moyen',     '€ / ha', tarifs['broyage-roseaux'].sans.moyen)}
        ${row('broyage-roseaux.sans.difficile', 'Accès difficile', '€ / ha', tarifs['broyage-roseaux'].sans.difficile)}

        ${sec('🌾 Broyage roseaux — avec ramassage')}
        ${row('broyage-roseaux.avec.facile',    'Accès facile',    '€ / ha', tarifs['broyage-roseaux'].avec.facile)}
        ${row('broyage-roseaux.avec.moyen',     'Accès moyen',     '€ / ha', tarifs['broyage-roseaux'].avec.moyen)}
        ${row('broyage-roseaux.avec.difficile', 'Accès difficile', '€ / ha', tarifs['broyage-roseaux'].avec.difficile)}
      </tbody>
    </table>
    <div id="tarifs-status" class="tarifs-status"></div>`;

  document.getElementById('btn-tarifs-save')?.addEventListener('click', saveTarifs);

  // Sync slider ↔ number input
  const slider = document.getElementById('coeff-slider');
  const pctInput = document.getElementById('coeff-pct');
  const sign = document.getElementById('coeff-sign');
  function updateSign(v) { sign.textContent = v >= 0 ? '+' : ''; sign.style.color = v < 0 ? 'var(--red)' : 'var(--green-600)'; }
  slider?.addEventListener('input', () => { pctInput.value = slider.value; updateSign(+slider.value); });
  pctInput?.addEventListener('input', () => { slider.value = pctInput.value; updateSign(+pctInput.value); });

  document.getElementById('coeff-apply')?.addEventListener('click', () => {
    const pct = parseFloat(pctInput.value) || 0;
    const factor = 1 + pct / 100;
    document.querySelectorAll('.tt-input[data-field]').forEach(input => {
      if (input.dataset.field.endsWith('.jussie')) return; // ne pas toucher au coefficient jussie
      const v = parseFloat(input.value) || 0;
      input.value = Math.round(v * factor);
    });
  });

  document.getElementById('coeff-reset')?.addEventListener('click', () => {
    slider.value = 0; pctInput.value = 0; updateSign(0);
    document.querySelectorAll('.tt-input[data-field]').forEach(input => {
      const keys = input.dataset.field.split('.');
      let obj = TARIFS_DEFAULTS;
      try { for (const k of keys) obj = obj[k]; input.value = obj; } catch {}
    });
  });
}

async function saveTarifs() {
  const tarifs = JSON.parse(JSON.stringify(TARIFS_DEFAULTS));

  document.querySelectorAll('.tt-input[data-field]').forEach(input => {
    const keys  = input.dataset.field.split('.');
    let obj = tarifs;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = parseFloat(input.value) || 0;
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
        </div>
      </div>

      <div class="dsec">
        <h3>Chantier ${d.lat && d.lng
          ? `<span class="dist-badge">📍 ${Math.round(haversineKm(DEPOT_LAT, DEPOT_LNG, d.lat, d.lng))} km du dépôt</span>`
          : ''}</h3>
        ${d.adresse ? `<div style="margin-bottom:.65rem"><div class="info-label">Adresse</div><div class="info-value">${esc(d.adresse)}</div></div>` : ''}
        <div class="info-grid">
          ${d.surface_ha   ? `<div><div class="info-label">Surface</div><div class="info-value">${d.surface_ha} ha</div></div>` : ''}
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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(adminMap);

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
  if (d.surface_ha)   parts.push(`${d.surface_ha} ha`);
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
