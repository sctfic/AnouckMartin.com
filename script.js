/* ============================================================
   ANOUCK MARTIN — Psychopraticienne
   Interactions, Animations & Maps
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initMobileNav();
  initScrollAnimations();
  initMaps();
  initSmoothScroll();
  initContent();
});

/* --- Header scroll effect --- */
function initHeader() {
  const header = document.querySelector('.header');
  if (!header) return;

  const onScroll = () => {
    if (window.scrollY > 60) {
      header.classList.add('header--scrolled');
    } else {
      header.classList.remove('header--scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* --- Mobile navigation --- */
function initMobileNav() {
  const burger = document.querySelector('.header__burger');
  const nav = document.querySelector('.header__nav');
  const overlay = document.querySelector('.nav-overlay');
  if (!burger || !nav) return;

  const toggle = () => {
    burger.classList.toggle('active');
    nav.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
    document.body.style.overflow = nav.classList.contains('open') ? 'hidden' : '';
  };

  const close = () => {
    burger.classList.remove('active');
    nav.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  };

  burger.addEventListener('click', toggle);
  if (overlay) overlay.addEventListener('click', close);

  // Close menu on nav link click
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', close);
  });
}

/* --- Scroll animations (IntersectionObserver) --- */
function initScrollAnimations() {
  const targets = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right');
  if (!targets.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  targets.forEach(el => observer.observe(el));
}

/* --- Smooth scroll for anchor links --- */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* --- Carte Leaflet (OpenStreetMap) — les 2 cabinets sur une carte --- */
function initMaps() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet not loaded — maps disabled');
    return;
  }

  const mapEl = document.getElementById('map-cabinets');
  if (!mapEl) return;

  // Cabinets + villes repères (Pau et Oloron-Sainte-Marie doivent être visibles)
  const points = {
    laroin: [43.3048255, -0.44374],
    lasseube: [43.2193501, -0.453609],
    pau: [43.2951, -0.3708],
    oloron: [43.1944, -0.6067]
  };

  const map = L.map('map-cabinets', {
    scrollWheelZoom: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  // Les 2 cabinets
  L.marker(points.laroin, { icon: getCustomIcon() })
    .addTo(map)
    .bindPopup('<strong>Cabinet de Laroin</strong><br>27 rue principale<br>64110 Laroin');

  L.marker(points.lasseube, { icon: getCustomIcon() })
    .addTo(map)
    .bindPopup('<strong>Cabinet de Lasseube</strong><br>Chemin Clergat<br>64290 Lasseube');

  // Villes repères (points discrets)
  const cityStyle = { radius: 5, color: '#1d2440', fillColor: '#1d2440', fillOpacity: 0.55, weight: 1 };
  L.circleMarker(points.pau, cityStyle).addTo(map).bindTooltip('Pau');
  L.circleMarker(points.oloron, cityStyle).addTo(map).bindTooltip('Oloron-Sainte-Marie');

  // Vue englobant Laroin, Lasseube, Pau et Oloron-Sainte-Marie
  map.fitBounds([points.laroin, points.lasseube, points.pau, points.oloron], { padding: [40, 40] });
}

/* Marqueur personnalisé — couleurs du thème Joyeux */
function getCustomIcon() {
  const mainColor = '#c65a49';
  const innerColor = '#df972c';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.164 0 0 7.164 0 16c0 12 16 28 16 28s16-16 16-28C32 7.164 24.836 0 16 0z" fill="${mainColor}"/>
        <circle cx="16" cy="15" r="7" fill="${innerColor}"/>
      </svg>
    `,
    iconSize: [32, 44],
    iconAnchor: [16, 44],
    popupAnchor: [0, -44],
  });
}

/* ============================================================
   CONTENU ÉDITORIAL — chargé depuis content.json
   Le fichier content.json contient les textes de la page,
   regroupés par section. Chaque bloc peut utiliser :
     *mot*  → gras      _mot_  → italique      ~mot~  → barré
   ============================================================ */

const CONTENT_URL = 'content.json';
var AM_STATE = null;

async function initContent() {
  // Aucun texte par défaut : on place d'abord « … » partout,
  // puis on injecte le contenu réel dès que content.json est chargé.
  showPlaceholders();

  let data;
  try {
    const res = await fetch(CONTENT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.warn('content.json indisponible — les emplacements restent affichés « … ».', err);
    return;
  }

  AM_STATE = data;
  renderAllContent(data);
  if (typeof window.__onContentApplied === 'function') {
    try { window.__onContentApplied(); } catch (e) { console.warn(e); }
  }
}

/* --- Petits helpers --- */
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* Convertit la syntaxe simple (*gras*, _italique_, ~barré~) en HTML sûr */
function rich(texte) {
  if (texte == null) return '';
  const safe = String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return safe
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~([^~]+)~/g, '<del>$1</del>');
}

/* Remplit un élément avec du texte mis en forme */
function fill(node, texte) {
  if (node && texte != null) node.innerHTML = rich(texte);
}

/* Remplace le contenu textuel d'éléments par « ... » */
function blank(nodes) {
  nodes.forEach(function (n) {
    if (n) n.innerHTML = '...';
  });
}

/* Remplace tous les textes éditoriaux par « … » (avant chargement du JSON) */
function showPlaceholders() {
  // Hero
  blank(qa('.hero__badge, .hero__name, .hero__title'));
  // Intro
  blank(qa('#intro .intro__kicker, #intro .section__title, #intro .intro__lead, #intro .intro__text'));
  // Situations
  blank(qa('#situations .section__title, #situations .section__subtitle, #situations .note-band p'));
  qa('#situations .service-card').forEach(function (card) {
    blank(qa('.service-card__title, .service-card__desc', card));
  });
  // Ressenti
  blank(qa('#ressenti .section__title, #ressenti .section__subtitle'));
  qa('#ressenti .approach__card').forEach(function (card) {
    blank(qa('h3, p', card));
  });
  // À propos
  blank(qa('#about .about__text h2, #about .about__text > p'));
  qa('#about .formation__list li').forEach(function (li) {
    const icon = q('.formation__icon', li);
    li.innerHTML = (icon ? icon.outerHTML : '') + '<span class="formation__value">...</span>';
  });
  // Approche
  blank(qa('#approach .section__title, #approach .section__subtitle'));
  qa('#approach .approach__card').forEach(function (card) {
    blank(qa('h3, p', card));
  });
  // Prestations
  blank(qa('#services .section__title, #services .section__subtitle'));
  qa('#services .practice-strip__item').forEach(function (item) {
    blank(qa('.practice-strip__label, .practice-strip__value', item));
  });
  const offer = q('#service-global');
  if (offer) blank(qa('.service-card__title, .service-card__desc', offer));
  // Cabinets
  blank(qa('#cabinets .section__title, #cabinets .section__subtitle'));
  qa('#cabinets .cabinet-block').forEach(function (card) {
    blank(qa('.cabinet-card__label, .cabinet-card__name, .cabinet-card__address-text, .cabinet-card__days', card));
  });
  // Contact
  blank(qa('#contact .section__title, #contact .section__subtitle'));
}

/* --- Hero --- */
function renderHero(b) {
  if (!b) return;
  fill(q('.hero__badge'), b.label);
  fill(q('.hero__name'), b.title);
  const heroTitle = q('.hero__title');
  if (heroTitle) {
    heroTitle.innerHTML = Array.isArray(b.texte)
      ? b.texte.map(rich).join('<br>')
      : rich(b.texte);
  }
}

/* --- Intro (Prendre le temps de vous écouter) --- */
function renderIntro(b) {
  if (!b) return;
  fill(q('#intro .intro__kicker'), b.label);
  fill(q('#intro .section__title'), b.title);
  const paras = Array.isArray(b.texte) ? b.texte : [b.texte];
  const nodes = qa('#intro .intro__lead, #intro .intro__text');
  paras.forEach(function (t, i) {
    if (nodes[i]) fill(nodes[i], t);
  });
}

/* --- Situations (3 cartes + note) --- */
function renderSituations(b) {
  if (!b) return;
  fill(q('#situations .section__title'), b.title);
  fill(q('#situations .section__subtitle'), b.texte);
  const els = qa('#situations .services__grid > article.service-card');
  (b.cards || []).forEach(function (c, i) {
    const el = els[i];
    if (!el) return;
    fill(q('.service-card__icon', el), c.label);
    fill(q('.service-card__title', el), c.title);
    fill(q('.service-card__desc', el), c.texte);
  });
  fill(q('#situations .note-band p'), b.note);
}

/* --- Ressenti (4 cartes) --- */
function renderRessenti(b) {
  if (!b) return;
  fill(q('#ressenti .section__title'), b.title);
  fill(q('#ressenti .section__subtitle'), b.texte);
  const els = qa('#ressenti .approach__grid > .approach__card');
  (b.cards || []).forEach(function (c, i) {
    const el = els[i];
    if (!el) return;
    fill(q('.approach__card h3', el), c.title);
    const ps = Array.from(el.children).filter(function (n) { return n.tagName === 'P'; });
    const paras = Array.isArray(c.texte) ? c.texte : [c.texte];
    paras.forEach(function (t, j) {
      if (ps[j]) fill(ps[j], t);
    });
  });
}

/* --- À propos / Qui est Anouck ? --- */
function renderAbout(b) {
  if (!b) return;
  fill(q('#about .about__text h2'), b.title);
  const ps = qa('#about .about__text > p');
  const paras = Array.isArray(b.texte) ? b.texte : [b.texte];
  paras.forEach(function (t, i) {
    if (ps[i]) fill(ps[i], t);
  });
  // Si le JSON contient plus de paragraphes que le HTML, on en crée (clone du dernier)
  if (paras.length > ps.length && ps.length) {
    const tmpl = ps[ps.length - 1];
    let cursor = tmpl;
    for (let i = ps.length; i < paras.length; i++) {
      const np = tmpl.cloneNode(false);
      np.innerHTML = rich(paras[i]);
      cursor.parentNode.insertBefore(np, cursor.nextSibling);
      cursor = np;
    }
  }
  // Encart Formation & Pratique (chaque ligne = icône + texte)
  const lis = qa('#about .formation__list li');
  (b.formation || []).forEach(function (f, i) {
    const li = lis[i];
    if (!li) return;
    li.innerHTML = '<span class="formation__icon" aria-hidden="true">' + rich(f.label) + '</span>' +
      '<span class="formation__value">' + rich(f.texte) + '</span>';
  });
}

/* --- Approche (2 cartes + déroulement pleine largeur) --- */
function renderApproach(b) {
  if (!b) return;
  fill(q('#approach .section__title'), b.title);
  fill(q('#approach .section__subtitle'), b.texte);
  const els = qa('#approach .approach__grid > .approach__card');
  (b.cards || []).forEach(function (c, i) {
    const el = els[i];
    if (!el) return;
    fill(q('.approach__card h3', el), c.title);
    let ps;
    const prose = q('.approach__prose', el);
    if (prose) {
      ps = qa('p', prose);
    } else {
      ps = Array.from(el.children).filter(function (n) { return n.tagName === 'P'; });
    }
    const paras = Array.isArray(c.texte) ? c.texte : [c.texte];
    paras.forEach(function (t, j) {
      if (ps[j]) fill(ps[j], t);
    });
  });
}

/* --- Prestations --- */
function renderServices(b) {
  if (!b) return;
  fill(q('#services .section__title'), b.title);
  fill(q('#services .section__subtitle'), b.texte);
  // Bandeau d'infos pratiques (label + valeur)
  const facts = qa('#services .practice-strip__item');
  (b.facts || []).forEach(function (f, i) {
    const el = facts[i];
    if (!el) return;
    fill(q('.practice-strip__label', el), f.label);
    fill(q('.practice-strip__value', el), f.texte);
  });
  // Carte offre globale
  if (b.offer) {
    fill(q('#service-global .service-card__icon'), b.offer.label);
    fill(q('#service-global .service-card__title'), b.offer.title);
    const ps = qa('#service-global .service-card__desc');
    const paras = Array.isArray(b.offer.texte) ? b.offer.texte : [b.offer.texte];
    paras.forEach(function (t, i) {
      if (ps[i]) fill(ps[i], t);
    });
  }
}

/* --- Cabinets --- */
function renderCabinets(b) {
  if (!b) return;
  fill(q('#cabinets .section__title'), b.title);
  fill(q('#cabinets .section__subtitle'), b.texte);
  const els = qa('#cabinets .cabinet-block');
  (b.cards || []).forEach(function (c, i) {
    const el = els[i];
    if (!el) return;
    fill(q('.cabinet-card__label', el), c.label);
    fill(q('.cabinet-card__name', el), c.title);
    fill(q('.cabinet-card__address-text', el), c.texte);
    fill(q('.cabinet-card__days', el), c.days);
  });
}

/* --- Contact --- */
function renderContact(b) {
  if (!b) return;
  fill(q('#contact .section__title'), b.title);
  fill(q('#contact .section__subtitle'), b.texte);
}

/* --- Application globale du contenu + pont pour le module admin --- */
function renderAllContent(d) {
  renderHero(d.hero);
  renderIntro(d.intro);
  renderSituations(d.situations);
  renderRessenti(d.ressenti);
  renderAbout(d.about);
  renderApproach(d.approach);
  renderServices(d.services);
  renderCabinets(d.cabinets);
  renderContact(d.contact);
}

function AM_apply(data) {
  if (!data) return;
  AM_STATE = data;
  renderAllContent(data);
  if (typeof window.__onContentApplied === 'function') {
    try { window.__onContentApplied(); } catch (e) { console.warn(e); }
  }
}

window.AM = {
  get: function () { return AM_STATE; },
  apply: AM_apply,
  md: function (t) { return rich(t); }
};

/* --- WhatsApp deep link (Android intent:// + fallback) --- */
function openWhatsApp() {
  const phone = '33648000045';
  const text = encodeURIComponent('Bonjour, je souhaiterais prendre rendez-vous pour une séance d\'accompagnement, seriez vous disponible prochainement ?');

  // Détection mobile Android
  const isAndroid = /android/i.test(navigator.userAgent);

  if (isAndroid) {
    // Android Intent URI — ouvre directement l'app WhatsApp si installée
    const intentUrl = `intent://send?phone=${phone}&text=${text}#Intent;scheme=whatsapp;package=com.whatsapp;end;`;
    window.location.href = intentUrl;
  } else {
    // Fallback universel (iOS, desktop, etc.)
    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${text}`, '_blank');
  }
}
