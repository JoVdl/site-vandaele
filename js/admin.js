/* ============================================================
   CURAGE VANDAELE – ADMIN JS
   ============================================================ */

// ── CONFIG ──────────────────────────────────────────────────
// Remplacer par vos valeurs : Supabase > Settings > API
const SUPABASE_URL      = 'https://VOTRE-PROJET.supabase.co';
const SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON';

// ── INIT ─────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allDemandes   = [];
let currentFilter = 'all';
let currentSearch = '';
let currentSort   = 'desc';
let openId        = null;

// ── AUTH ─────────────────────────────────────────────────────
const loginScreen = document.getElementById('login-screen');
const dashboard   = document.getElementById('dashboard');

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    loginScreen.hidden = true;
    dashboard.hidden   = false;
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = session.user.email;
    loadDemandes();
  } else {
    loginScreen.hidden = false;
    dashboard.hidden   = true;
    allDemandes = [];
  }
});

document.getElementById('login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-password').value;

  btn.disabled    = true;
  btn.textContent = 'Connexion…';
  errEl.hidden    = true;

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });

  if (error) {
    errEl.textContent = 'Email ou mot de passe incorrect.';
    errEl.hidden      = false;
    btn.disabled      = false;
    btn.textContent   = 'Se connecter';
  }
});

document.getElementById('logout-btn')?.addEventListener('click', () => sb.auth.signOut());

// ── LOAD DATA ────────────────────────────────────────────────
async function loadDemandes() {
  const listEl = document.getElementById('requests-list');
  if (listEl) listEl.innerHTML = '<div class="state-msg">Chargement…</div>';

  const { data, error } = await sb
    .from('demandes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (listEl) listEl.innerHTML = `<div class="state-msg">Erreur : ${esc(error.message)}</div>`;
    return;
  }

  allDemandes = data || [];
  renderStats();
  renderList();
}

document.getElementById('btn-refresh')?.addEventListener('click', loadDemandes);

// ── STATS ────────────────────────────────────────────────────
function renderStats() {
  set('stat-total',   allDemandes.length);
  set('stat-nouveau', allDemandes.filter(d => d.statut === 'nouveau').length);
  set('stat-encours', allDemandes.filter(d => ['contacte', 'devis_envoye'].includes(d.statut)).length);
  set('stat-gagne',   allDemandes.filter(d => d.statut === 'chantier_gagne').length);
}

// ── FILTERS ──────────────────────────────────────────────────
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

// ── RENDER LIST ──────────────────────────────────────────────
function renderList() {
  const listEl = document.getElementById('requests-list');
  if (!listEl) return;

  let items = [...allDemandes];

  if (currentFilter !== 'all') {
    items = items.filter(d => (d.statut || 'nouveau') === currentFilter);
  }

  if (currentSearch) {
    items = items.filter(d => {
      const hay = [d.prenom, d.nom, d.email, d.telephone, d.adresse].join(' ').toLowerCase();
      return hay.includes(currentSearch);
    });
  }

  if (currentSort === 'asc') items.reverse();

  if (!items.length) {
    listEl.innerHTML = '<div class="state-msg">Aucune demande trouvée.</div>';
    return;
  }

  listEl.innerHTML = items.map(renderCard).join('');
  listEl.querySelectorAll('.req-card').forEach(card => {
    card.addEventListener('click', () => openDrawer(card.dataset.id));
  });
}

function renderCard(d) {
  const statut = d.statut || 'nouveau';
  const tags   = (d.travaux || []).map(t => `<span class="ctag">${travailShort(t)}</span>`).join('');
  return `
    <div class="req-card s-${statut}" data-id="${esc(d.id)}">
      <div class="card-main">
        <div class="card-name">${esc(d.prenom || '')} ${esc(d.nom || '')}</div>
        <div class="card-addr">${esc(d.adresse || d.email || '–')}</div>
        <div class="card-tags">${tags}</div>
      </div>
      <div class="card-right">
        <div class="card-amount">${esc(d.estimation_text || '–')}</div>
        <div class="card-date">${fmtRelative(d.created_at)}</div>
        <div class="card-badge"><span class="badge b-${statut}">${statutLabel(statut)}</span></div>
      </div>
    </div>`;
}

// ── DRAWER ───────────────────────────────────────────────────
const overlay = document.getElementById('detail-overlay');
const drawer  = document.getElementById('detail-drawer');

function openDrawer(id) {
  const d = allDemandes.find(x => x.id === id);
  if (!d) return;
  openId = id;

  set('drawer-name', `${d.prenom || ''} ${d.nom || ''}`.trim() || '–');
  set('drawer-meta', `Reçu le ${fmtDate(d.created_at)} · ${statutLabel(d.statut || 'nouveau')}`);
  renderDrawerBody(d);

  overlay.hidden = false;
  drawer.hidden  = false;
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  overlay.hidden = true;
  drawer.hidden  = true;
  openId = null;
  document.body.style.overflow = '';
}

document.getElementById('drawer-close')?.addEventListener('click', closeDrawer);
overlay?.addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

function renderDrawerBody(d) {
  const bodyEl = document.getElementById('drawer-body');
  if (!bodyEl) return;

  const statut  = d.statut || 'nouveau';
  const travaux = d.travaux || [];
  const details = d.details || {};

  const profilMap = { particulier:'Particulier', association:'Association', collectivite:'Collectivité', agriculteur:'Agriculteur', autre:'Autre' };
  const delaiMap  = { urgent:'Urgent', '3mois':'Dans 3 mois', '6mois':'Dans 6 mois', '1an':'Dans l\'année', indefini:'Non défini' };
  const accesMap  = { facile:'Facile', moyen:'Moyen', difficile:'Difficile' };

  // Build details rows
  let detailRows = '';
  if (details.hydrocurage) {
    detailRows += drow('Hydrocurage – longueur', `${details.hydrocurage.longueur_ml} ml`);
  }
  if (details.curage) {
    const c = details.curage;
    const destLabel = { 'sur-place':'Épandage sur place', 'evacuation':'Évacuation', 'valorisation':'Valorisation agri.' };
    detailRows += drow('Curage – prof. de vase', `${c.prof_vase_cm} cm`);
    detailRows += drow('Curage – surface concernée', `${c.pct_surface} %`);
    detailRows += drow('Destination de la vase', destLabel[c.destination_vase] || c.destination_vase);
  }
  if (details.faucardage) {
    const f = details.faucardage;
    detailRows += drow('Faucardage – couverture végétale', `${f.pct_couverture} %`);
    if (f.jussie) detailRows += drow('Jussie (invasive)', 'Oui (+40 %)');
  }
  if (details.berges) {
    const b = details.berges;
    const typeMap = { enrochement:'Enrochement', palplanche:'Palplanches', gabion:'Gabions', vegetal:'Génie végétal', conseil:'À définir' };
    detailRows += drow('Berges – longueur', `${b.longueur_ml} ml`);
    detailRows += drow('Type de protection', typeMap[b.type] || b.type);
  }
  if (details['broyage-forestier']) {
    const bf = details['broyage-forestier'];
    const densMap = { legere:'Légère', moyenne:'Moyenne', dense:'Dense' };
    detailRows += drow('Broyage forestier – surface', `${bf.surface_ha} ha`);
    detailRows += drow('Densité de végétation', densMap[bf.densite] || bf.densite);
  }
  if (details['broyage-roseaux']) {
    const br = details['broyage-roseaux'];
    detailRows += drow('Broyage roseaux – surface', `${br.surface_ha} ha`);
    detailRows += drow('Avec ramassage', br.avec_ramassage ? 'Oui' : 'Non');
  }

  bodyEl.innerHTML = `
    <div class="dsec">
      <h3>Contact</h3>
      <div class="info-grid">
        <div>
          <div class="info-label">Email</div>
          <div class="info-value"><a href="mailto:${esc(d.email)}">${esc(d.email || '–')}</a></div>
        </div>
        <div>
          <div class="info-label">Téléphone</div>
          <div class="info-value"><a href="tel:${esc(d.telephone)}">${esc(d.telephone || '–')}</a></div>
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
        ${d.surface_ha  ? `<div><div class="info-label">Surface</div><div class="info-value">${d.surface_ha} ha</div></div>` : ''}
        ${d.perimetre_ml ? `<div><div class="info-label">Périmètre</div><div class="info-value">${d.perimetre_ml} ml</div></div>` : ''}
        <div><div class="info-label">Accès</div><div class="info-value">${esc(accesMap[d.acces] || d.acces || '–')}</div></div>
      </div>
      <div style="margin-top:.7rem">
        <div class="info-label" style="margin-bottom:.35rem">Travaux demandés</div>
        <div class="work-chips">${travaux.map(t => `<span class="work-chip">${travailLabel(t)}</span>`).join('') || '–'}</div>
      </div>
    </div>

    ${detailRows ? `
    <div class="dsec">
      <h3>Détails des travaux</h3>
      <div>${detailRows}</div>
    </div>` : ''}

    ${d.infos_sup ? `
    <div class="dsec">
      <h3>Informations complémentaires</h3>
      <p style="font-size:.85rem;color:var(--gray-700);line-height:1.6;white-space:pre-wrap;">${esc(d.infos_sup)}</p>
    </div>` : ''}

    <div class="est-total">
      <div class="est-total-label">Estimation indicative</div>
      <div class="est-total-val">${esc(d.estimation_text || '–')}</div>
    </div>

    <div class="admin-sec">
      <h3>Suivi</h3>
      <select class="statut-sel" id="drawer-statut">
        <option value="nouveau"        ${statut==='nouveau'        ?'selected':''}>🔴 Nouveau</option>
        <option value="contacte"       ${statut==='contacte'       ?'selected':''}>🟡 Contacté</option>
        <option value="devis_envoye"   ${statut==='devis_envoye'   ?'selected':''}>🔵 Devis envoyé</option>
        <option value="chantier_gagne" ${statut==='chantier_gagne' ?'selected':''}>🟢 Chantier gagné</option>
        <option value="sans_suite"     ${statut==='sans_suite'     ?'selected':''}>⚫ Sans suite</option>
      </select>
      <div class="note-lbl">Note interne</div>
      <textarea class="note-ta" id="drawer-note" placeholder="Ajouter une note…">${esc(d.note_admin || '')}</textarea>
      <div class="note-saved" id="note-saved"></div>
    </div>`;

  // Status change → save immediately
  document.getElementById('drawer-statut')?.addEventListener('change', async e => {
    const newStatut = e.target.value;
    const { error } = await sb
      .from('demandes')
      .update({ statut: newStatut, updated_at: new Date().toISOString() })
      .eq('id', d.id);
    if (!error) {
      const idx = allDemandes.findIndex(x => x.id === d.id);
      if (idx >= 0) allDemandes[idx].statut = newStatut;
      renderStats();
      renderList();
      set('drawer-meta', `Reçu le ${fmtDate(d.created_at)} · ${statutLabel(newStatut)}`);
    }
  });

  // Note → auto-save 800ms after stop typing
  let noteSaveTimer = null;
  document.getElementById('drawer-note')?.addEventListener('input', () => {
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(async () => {
      const note = document.getElementById('drawer-note')?.value || '';
      const { error } = await sb
        .from('demandes')
        .update({ note_admin: note, updated_at: new Date().toISOString() })
        .eq('id', d.id);
      if (!error) {
        const idx = allDemandes.findIndex(x => x.id === d.id);
        if (idx >= 0) allDemandes[idx].note_admin = note;
        const el = document.getElementById('note-saved');
        if (el) { el.textContent = '✓ Sauvegardé'; el.style.opacity = '1'; setTimeout(() => { if (el) el.style.opacity = '0'; }, 2000); }
      }
    }, 800);
  });
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

function fmtDate(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'À l\'instant';
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `Il y a ${d}j`;
  if (d < 30) return `Il y a ${Math.floor(d/7)} sem.`;
  return new Date(ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
}

function statutLabel(s) {
  return { nouveau:'Nouveau', contacte:'Contacté', devis_envoye:'Devis envoyé', chantier_gagne:'Gagné', sans_suite:'Sans suite' }[s] || s;
}

function travailLabel(t) {
  return { hydrocurage:'💧 Hydrocurage', curage:'🚜 Curage mécanique', faucardage:'🌿 Faucardage', berges:'🪨 Défenses de berges', 'broyage-forestier':'🌲 Broyage forestier', 'broyage-roseaux':'🌾 Broyage roseaux', diagnostic:'🔍 Diagnostic' }[t] || t;
}

function travailShort(t) {
  return { hydrocurage:'💧 Hydro.', curage:'🚜 Curage', faucardage:'🌿 Faucardage', berges:'🪨 Berges', 'broyage-forestier':'🌲 Broyage', 'broyage-roseaux':'🌾 Roseaux', diagnostic:'🔍 Diagnostic' }[t] || t;
}
