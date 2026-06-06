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

let allDemandes   = [];
let currentFilter = 'all';
let currentSearch = '';
let adminMap      = null; // instance Leaflet réutilisable
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
      if (openId) {
        const d = allDemandes.find(x => x.id === openId);
        if (d) renderDetailPane(d);
      }
    }, err => {
      const listEl = document.getElementById('requests-list');
      if (listEl) listEl.innerHTML = `<div class="state-msg">Erreur : ${esc(err.message)}</div>`;
    });
}

function stopListener() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

document.getElementById('btn-refresh')?.addEventListener('click', startListener);

// ── STATS ────────────────────────────────────────────────────
function renderStats() {
  set('stat-total',   allDemandes.length);
  set('stat-nouveau', allDemandes.filter(d => (d.statut || 'nouveau') === 'nouveau').length);
  set('stat-encours', allDemandes.filter(d => ['contacte', 'devis_envoye'].includes(d.statut)).length);
  set('stat-gagne',   allDemandes.filter(d => d.statut === 'chantier_gagne').length);
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
  if (currentFilter !== 'all') items = items.filter(d => (d.statut || 'nouveau') === currentFilter);
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
    : !isContact && d.estimation_text
      ? `<div class="card-amount">${esc(d.estimation_text)}</div>`
      : '';

  return `
    <div class="req-card s-${statut}${isActive ? ' is-active' : ''}" data-id="${esc(d.id)}">
      <div class="card-main">
        <div class="card-name">${name}</div>
        <div class="card-addr">${esc(d.email || '–')}</div>
        <div class="card-tags">${tags}</div>
        ${preview}
      </div>
      <div class="card-right">
        <div class="card-date">${fmtRelative(d.created_at)}</div>
        <div class="card-badge"><span class="badge b-${statut}">${statutLabel(statut)}</span></div>
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
      detailRows += drow('Hydrocurage – longueur', `${details.hydrocurage.longueur_ml} ml`);
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
        <h3>Chantier</h3>
        ${d.adresse ? `<div style="margin-bottom:.65rem"><div class="info-label">Adresse</div><div class="info-value">${esc(d.adresse)}</div></div>` : ''}
        <div class="info-grid">
          ${d.surface_ha   ? `<div><div class="info-label">Surface</div><div class="info-value">${d.surface_ha} ha</div></div>` : ''}
          ${d.perimetre_ml ? `<div><div class="info-label">Périmètre</div><div class="info-value">${d.perimetre_ml} ml</div></div>` : ''}
          ${d.acces ? `<div><div class="info-label">Accès</div><div class="info-value">${esc(accesMap[d.acces] || d.acces)}</div></div>` : ''}
        </div>
        ${travaux.length ? `
        <div style="margin-top:.7rem">
          <div class="info-label" style="margin-bottom:.35rem">Travaux demandés</div>
          <div class="work-chips">${travaux.map(t => `<span class="work-chip">${travailLabel(t)}</span>`).join('')}</div>
        </div>` : ''}
        ${d.geojson ? `<div id="admin-map" style="height:220px;margin-top:.9rem;border-radius:8px;overflow:hidden;background:var(--gray-200);"></div>` : ''}
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
      <h2>${name}</h2>
      <div class="detail-meta" id="detail-meta">Reçu le ${fmtDate(d.created_at)} · ${statutLabel(statut)}</div>
    </div>
    <div class="detail-scroll">
      ${contentHtml}
      <div class="admin-sec">
        <h3>Suivi</h3>
        <select class="statut-sel" id="detail-statut">
          <option value="nouveau"        ${statut==='nouveau'        ?'selected':''}>🔴 Nouveau</option>
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

  // Carte du tracé client
  if (d.geojson) {
    loadLeaflet(() => renderAdminMap(d.geojson));
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

function renderAdminMap(geojson) {
  const el = document.getElementById('admin-map');
  if (!el) return;
  if (adminMap) { adminMap.remove(); adminMap = null; }
  adminMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(adminMap);
  const layer = L.geoJSON(geojson, {
    style: { color: '#3d9e62', weight: 2.5, fillColor: '#56b57a', fillOpacity: 0.2 }
  }).addTo(adminMap);
  adminMap.fitBounds(layer.getBounds(), { padding: [24, 24] });
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
  return { nouveau:'Nouveau', contacte:'Contacté', devis_envoye:'Devis envoyé', chantier_gagne:'Gagné', sans_suite:'Sans suite' }[s] || s;
}

function travailLabel(t) {
  return { hydrocurage:'💧 Hydrocurage', curage:'🚜 Curage mécanique', faucardage:'🌿 Faucardage', berges:'🪨 Défenses de berges', 'broyage-forestier':'🌲 Broyage forestier', 'broyage-roseaux':'🌾 Broyage roseaux', diagnostic:'🔍 Diagnostic' }[t] || t;
}

function travailShort(t) {
  return { hydrocurage:'💧 Hydro.', curage:'🚜 Curage', faucardage:'🌿 Fauc.', berges:'🪨 Berges', 'broyage-forestier':'🌲 Broyage', 'broyage-roseaux':'🌾 Roseaux', diagnostic:'🔍 Diag.' }[t] || t;
}
