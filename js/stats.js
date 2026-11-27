// ============================================================
// CURAGE VANDAELE – Mesure d'audience maison (sans cookie)
// Une ligne par page vue dans la collection Firestore `visites`.
// Pas d'adresse IP, pas de cookie, identifiant de session aléatoire
// gardé uniquement dans sessionStorage (effacé à la fermeture de l'onglet).
// Désactivé si le visiteur demande « Ne pas suivre ».
// ============================================================
(function () {
  'use strict';

  var PROJECT = 'curage-vandaele';
  var API_KEY = 'AIzaSyCedrdegva_01oxW1zqhMX-qrRdn_Xczjc';
  var ENDPOINT = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
    '/databases/(default)/documents/visites?key=' + API_KEY;

  if (navigator.doNotTrack === '1' || navigator.webdriver) return;
  if (/\/admin(\.html)?$/.test(location.pathname)) return;

  var own = location.hostname.replace(/^www\./, '');

  function session(key, make) {
    try {
      var v = sessionStorage.getItem(key);
      if (!v) { v = make(); sessionStorage.setItem(key, v); }
      return v;
    } catch (e) {
      return make();
    }
  }
  function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  var sid = session('cv_sid', randomId);
  var previous = parseInt(session('cv_pages', function () { return '0'; }), 10) || 0;
  try { sessionStorage.setItem('cv_pages', String(previous + 1)); } catch (e) { /* navigation privée */ }
  var entry = previous === 0; // première page vue de la visite = page d'entrée

  var params = new URLSearchParams(location.search);
  var refHost = '';
  try { refHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { refHost = ''; }
  var internal = refHost !== '' && (refHost === own || refHost.slice(-own.length - 1) === '.' + own);

  function classify() {
    if (params.get('utm_source')) return 'campagne';
    if (!refHost) return 'direct';
    if (internal) return 'interne';
    if (/google|bing|qwant|duckduckgo|ecosia|yahoo|startpage|brave|ecosia/.test(refHost)) return 'moteur de recherche';
    if (/facebook|instagram|linkedin|twitter|x\.com|t\.co|tiktok|youtube|pinterest|whatsapp|messenger/.test(refHost)) return 'réseau social';
    return 'autre site';
  }

  var source = classify();
  var device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'ordinateur';
  var start = Date.now();
  var sent = false;

  function send() {
    if (sent) return;
    sent = true;
    var seconds = Math.min(7200, Math.max(0, Math.round((Date.now() - start) / 1000)));
    var body = { fields: {
      path:     { stringValue: location.pathname.slice(0, 200) || '/' },
      ts:       { timestampValue: new Date(start).toISOString() },
      duration: { integerValue: String(seconds) },
      source:   { stringValue: source },
      referrer: { stringValue: refHost.slice(0, 120) },
      device:   { stringValue: device },
      sid:      { stringValue: sid },
      entry:    { booleanValue: entry },
      campaign: { stringValue: (params.get('utm_campaign') || '').slice(0, 80) }
    } };
    try {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) { /* hors ligne : on ignore */ }
  }

  window.addEventListener('pagehide', send);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send();
  });
})();
