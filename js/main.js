/* ============================================================
   CURAGE VANDAELE – MAIN JS
   ============================================================ */

// ── NAVBAR scroll ──
const header = document.getElementById('site-header');
if (header) {
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
}

// ── MOBILE NAV ──
const navToggle = document.getElementById('nav-toggle');
const navLinks  = document.getElementById('nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open);
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// ── ACTIVE NAV LINK ──
const currentPath = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(a => {
  const href = a.getAttribute('href').split('#')[0];
  a.classList.toggle('active', href === currentPath);
});

// ── CONTACT FORM ──
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = contactForm.querySelector('[type=submit]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Envoi en cours…';

    const key = contactForm.querySelector('[name=access_key]').value;
    if (!key || key === 'VOTRE_CLE_WEB3FORMS') {
      showToast('Clé Web3Forms manquante — configurez-la dans index.html', 'error');
      btn.disabled = false;
      btn.textContent = original;
      return;
    }

    try {
      const res  = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: new FormData(contactForm)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Message envoyé ! Nous vous répondrons sous 48 h.', 'success');
        contactForm.reset();
      } else {
        showToast('Erreur lors de l\'envoi. Appelez-nous directement.', 'error');
      }
    } catch {
      showToast('Erreur réseau. Appelez-nous au 06 32 44 11 17.', 'error');
    }

    btn.disabled = false;
    btn.textContent = original;
  });
}

// ── CHANTIERS FILTER ──
const filterBtns = document.querySelectorAll('.filter-btn');
if (filterBtns.length) {
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.filter;
      document.querySelectorAll('.chantier-card[data-cat]').forEach(card => {
        card.style.display = (cat === 'all' || card.dataset.cat === cat) ? '' : 'none';
      });
    });
  });
}

// ── TOAST ──
function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' toast--' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 4000);
}

// ── RGPD COOKIE BANNER ──
(function () {
  if (localStorage.getItem('cookies_choice')) return;
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  setTimeout(() => banner.classList.add('visible'), 600);

  document.getElementById('cookie-accept').addEventListener('click', () => {
    localStorage.setItem('cookies_choice', 'accepted');
    banner.classList.remove('visible');
    document.body.classList.remove('cookie-visible');
  });
  document.getElementById('cookie-refuse').addEventListener('click', () => {
    localStorage.setItem('cookies_choice', 'refused');
    banner.classList.remove('visible');
    document.body.classList.remove('cookie-visible');
  });

  document.body.classList.add('cookie-visible');
  banner.addEventListener('transitionend', () => {
    if (!banner.classList.contains('visible')) document.body.classList.remove('cookie-visible');
  });
})();

// ── DRAGUE VERTICALE v3 – vue du dessus · machine descend · tuyau + bassin ──
(function () {
  const strip    = document.getElementById('dg-s-strip');
  const machine  = document.getElementById('dg-s-machine');
  const basinMud = document.getElementById('dg-s-basin-mud');
  const dgPipe   = document.getElementById('dg-s-pipe');
  if (!strip || !machine) return;

  // Hauteur totale machine non scalée : SVG hull (90px) + disque auger (44px)
  const MACHINE_H_BASE = 134;
  const HEADER_H       = 88;
  const MARGIN_B       = 20;

  // Facteur d'échelle CSS selon la largeur d'écran (doit correspondre aux media queries)
  function getScale() {
    const w = window.innerWidth;
    if (w <= 767)  return 0.46;
    if (w <= 1199) return 0.67;
    return 1;
  }

  function update() {
    const viewH     = window.innerHeight;
    const scrollMax = document.documentElement.scrollHeight - viewH;
    const progress  = scrollMax > 0 ? Math.min(window.scrollY / scrollMax, 1) : 0;

    const scale     = getScale();
    const machineH  = Math.round(MACHINE_H_BASE * scale);

    // Position verticale de la machine (haut → bas)
    const topMin = HEADER_H;
    const topMax = viewH - machineH - MARGIN_B;
    const top    = Math.round(topMin + progress * Math.max(0, topMax - topMin));
    machine.style.top = top + 'px';

    // Tuyau : s'arrête exactement à la poupe de la drague (ni devant, ni à côté)
    if (dgPipe) dgPipe.style.bottom = (viewH - top) + 'px';

    // Remplissage du bassin (0 → 100 % au scroll)
    if (basinMud) basinMud.style.height = (progress * 100).toFixed(1) + '%';

    // Gradient : eau bleue au-dessus du front de curage, boue marron dessous
    const splitY = top + machineH;
    const sp     = (splitY / viewH * 100);
    const s      = v => Math.min(100, Math.max(0, v)).toFixed(1);

    strip.style.background = [
      'linear-gradient(to bottom,',
      '#07223a 0%,',
      `#0e5898 ${s(sp - 12)}%,`,
      `#1a80c0 ${s(sp - 3)}%,`,
      `#c07828 ${s(sp)}%,`,
      `#7a3812 ${s(sp + 7)}%,`,
      '#361504 100%)'
    ].join(' ');
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
})();

// ── SCROLL ANIMATIONS ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.service-card, .chantier-card, .feature, .conseil-card, .article-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity .5s ease, transform .5s ease';
  observer.observe(el);
});
