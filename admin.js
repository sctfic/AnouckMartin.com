/* ============================================================
   ANOUCK MARTIN — Module d'administration
   ------------------------------------------------------------
   Bouton « Admin » du menu :
   - Authentification via /api (admin.json, hash du mot de passe)
   - Session persistante 48 h (jeton conservé localement)
   - Si aucun mot de passe n'existe, le premier saisi devient admin
   - Mode édition : un clic sur un bloc ouvre une zone de saisie ;
     quitter (perte de focus) ou Entrée valide et enregistre le JSON.
     Échap annule.
   Le fichier d'édition de référence est content.json ; les
   sauvegardes horodatées sont gérées par le serveur (server.js).
   ============================================================ */
(function () {
  'use strict';

  var API = '/api';
  var SESSION_KEY = 'am_admin_session';
  var SESSION_TTL_MS = 48 * 60 * 60 * 1000;

  var amEnabled = false;
  var editing = null;
  var saving = false;
  var modalMode = 'login';

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /* ---------------- Session locale (48 h) ---------------- */
  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && s.exp && s.exp > Date.now()) return s;
    } catch (e) { /* ignore */ }
    return null;
  }
  function storeSession(token, ttl) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: token, exp: Date.now() + (ttl || SESSION_TTL_MS) }));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function sessionToken() {
    var s = readSession();
    return s ? s.token : null;
  }

  /* ---------------- Accès au contenu (window.AM) ---------------- */
  function current() { return (window.AM && window.AM.get) ? window.AM.get() : null; }
  function md(t) { return (window.AM && window.AM.md) ? window.AM.md(t) : (t == null ? '' : String(t)); }

  function getPath(obj, path) {
    return String(path).split('.').reduce(function (acc, key) {
      return (acc == null) ? null : acc[key];
    }, obj);
  }
  function setPath(obj, path, value) {
    var seg = String(path).split('.');
    var key = seg.pop();
    var parent = seg.reduce(function (acc, k) { return (acc == null) ? null : acc[k]; }, obj);
    if (parent != null) parent[key] = value;
  }
  function isArrayValue(v) { return Array.isArray(v); }
  function toEditText(v) { return isArrayValue(v) ? v.join('\n') : (v == null ? '' : String(v)); }
  function toDisplayHtml(v) {
    if (isArrayValue(v)) return v.map(md).join('<br>');
    return md(v == null ? '' : v);
  }

  /* ---------------- Liaison des blocs éditables ---------------- */
  function tag(el, path) { if (el) el.setAttribute('data-edit', path); }

  function attachEditPaths() {
    // Hero
    tag(q('.hero__badge'), 'hero.label');
    tag(q('.hero__name'), 'hero.title');
    tag(q('.hero__title'), 'hero.texte');
    // Intro
    tag(q('#intro .intro__kicker'), 'intro.label');
    tag(q('#intro .section__title'), 'intro.title');
    qa('#intro .intro__lead, #intro .intro__text').forEach(function (n, i) { tag(n, 'intro.texte.' + i); });
    // Situations
    tag(q('#situations .section__title'), 'situations.title');
    tag(q('#situations .section__subtitle'), 'situations.texte');
    qa('#situations article.service-card').forEach(function (card, i) {
      tag(q('.service-card__icon', card), 'situations.cards.' + i + '.label');
      tag(q('.service-card__title', card), 'situations.cards.' + i + '.title');
      tag(q('.service-card__desc', card), 'situations.cards.' + i + '.texte');
    });
    tag(q('#situations .note-band p'), 'situations.note');
    // Ressenti
    tag(q('#ressenti .section__title'), 'ressenti.title');
    tag(q('#ressenti .section__subtitle'), 'ressenti.texte');
    qa('#ressenti .approach__card').forEach(function (card, i) {
      tag(q('h3', card), 'ressenti.cards.' + i + '.title');
      Array.from(card.children).filter(function (n) { return n.tagName === 'P'; })
        .forEach(function (p) { tag(p, 'ressenti.cards.' + i + '.texte'); });
    });
    // À propos
    tag(q('#about .about__text h2'), 'about.title');
    qa('#about .about__text > p').forEach(function (p, i) { tag(p, 'about.texte.' + i); });
    qa('#about .formation__list li').forEach(function (li, i) {
      tag(q('.formation__value', li), 'about.formation.' + i + '.texte');
    });
    // Approche
    tag(q('#approach .section__title'), 'approach.title');
    tag(q('#approach .section__subtitle'), 'approach.texte');
    qa('#approach .approach__card').forEach(function (card, i) {
      tag(q('.approach__card h3', card), 'approach.cards.' + i + '.title');
      var prose = q('.approach__prose', card);
      var ps = prose ? qa('p', prose)
        : Array.from(card.children).filter(function (n) { return n.tagName === 'P'; });
      ps.forEach(function (p, j) { tag(p, 'approach.cards.' + i + '.texte.' + j); });
    });
    // Prestations
    tag(q('#services .section__title'), 'services.title');
    tag(q('#services .section__subtitle'), 'services.texte');
    qa('#services .practice-strip__item').forEach(function (it, i) {
      tag(q('.practice-strip__label', it), 'services.facts.' + i + '.label');
      tag(q('.practice-strip__value', it), 'services.facts.' + i + '.texte');
    });
    tag(q('#service-global .service-card__icon'), 'services.offer.label');
    tag(q('#service-global .service-card__title'), 'services.offer.title');
    qa('#service-global .service-card__desc').forEach(function (p, i) { tag(p, 'services.offer.texte.' + i); });
    // Cabinets
    tag(q('#cabinets .section__title'), 'cabinets.title');
    tag(q('#cabinets .section__subtitle'), 'cabinets.texte');
    qa('#cabinets .cabinet-card').forEach(function (card, i) {
      tag(q('.cabinet-card__label', card), 'cabinets.cards.' + i + '.label');
      tag(q('.cabinet-card__name', card), 'cabinets.cards.' + i + '.title');
      tag(q('.cabinet-card__address-text', card), 'cabinets.cards.' + i + '.texte');
      tag(q('.cabinet-card__days', card), 'cabinets.cards.' + i + '.days');
    });
    // Contact
    tag(q('#contact .section__title'), 'contact.title');
    tag(q('#contact .section__subtitle'), 'contact.texte');
  }

  /* ---------------- Édition en place ---------------- */
  function beginEdit(el) {
    if (!amEnabled || editing || saving) return;
    var content = current();
    if (!content) return;
    var path = el.getAttribute('data-edit');
    if (!path) return;

    var oldValue = getPath(content, path);
    var wasArray = isArrayValue(oldValue);

    var ta = document.createElement('textarea');
    ta.className = 'am-editor';
    ta.spellcheck = false;
    ta.value = toEditText(oldValue);

    el.classList.add('am-editing');
    el.innerHTML = '';
    el.appendChild(ta);
    ta.focus();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) { /* ignore */ }

    editing = { el: el, path: path, oldValue: oldValue, wasArray: wasArray, ta: ta, done: false };

    function finishAndRender(node, value) {
      node.classList.remove('am-editing');
      node.innerHTML = toDisplayHtml(value);
    }

    function restore() {
      var ed = editing;
      if (!ed || ed.done) return;
      ed.done = true;
      editing = null;
      finishAndRender(ed.el, ed.oldValue);
    }

    function commit() {
      var ed = editing;
      if (!ed || ed.done) return;
      ed.done = true;
      editing = null;

      var raw = ed.ta.value;
      var next = ed.wasArray ? raw.split('\n') : raw;
      setPath(current(), ed.path, next);

      saving = true;
      saveAll().then(function () {
        saving = false;
        finishAndRender(ed.el, getPath(current(), ed.path));
      }).catch(function (err) {
        saving = false;
        setPath(current(), ed.path, ed.oldValue);
        finishAndRender(ed.el, ed.oldValue);
        flash('Enregistrement impossible : ' + (err && err.message ? err.message : err), true);
      });
    }

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); restore(); }
      else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); }
    });
  }

  function editDelegate(ev) {
    if (!amEnabled || editing || saving) return;
    var target = ev.target;
    var el = target && target.closest ? target.closest('[data-edit]') : null;
    if (!el) return;
    ev.preventDefault();
    beginEdit(el);
  }

  /* ---------------- Enregistrement ---------------- */
  function saveAll() {
    var content = current();
    if (!content) return Promise.reject(new Error('Contenu non chargé'));
    var tok = sessionToken();
    if (!tok) return Promise.reject(new Error('Non connecté'));
    return fetch(API + '/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ content: content })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('Erreur serveur ' + res.status));
        return data;
      });
    });
  }

  /* ---------------- API d'authentification ---------------- */
  function apiPost(route, body) {
    return fetch(API + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('Erreur serveur ' + res.status));
        return data;
      });
    });
  }

  /* ---------------- Activation / désactivation ---------------- */
  function enableEditMode() {
    amEnabled = true;
    document.body.classList.add('am-admin');
    var btn = q('#admin-btn');
    if (btn) { btn.textContent = 'Admin ✓'; btn.classList.add('is-active'); }
    attachEditPaths();
  }
  function disableEditMode() {
    if (editing) {
      editing.el.classList.remove('am-editing');
      editing.el.innerHTML = toDisplayHtml(editing.oldValue);
      editing = null;
    }
    amEnabled = false;
    document.body.classList.remove('am-admin');
    var btn = q('#admin-btn');
    if (btn) { btn.textContent = 'Admin'; btn.classList.remove('is-active'); }
  }

  /* ---------------- Fenêtre modale ---------------- */
  function ensureModal() {
    if (q('.am-overlay')) return;
    var ov = document.createElement('div');
    ov.className = 'am-overlay';
    ov.id = 'am-overlay';
    ov.innerHTML =
      '<div class="am-modal" role="dialog" aria-modal="true" aria-labelledby="am-title">' +
      '<button type="button" class="am-close" id="am-close" aria-label="Fermer">&times;</button>' +
      '<h2 class="am-title" id="am-title">Espace admin</h2>' +
      '<p class="am-msg" id="am-msg"></p>' +
      '<form id="am-form" autocomplete="off">' +
      '<label class="am-label" for="am-pass">Mot de passe</label>' +
      '<input type="password" id="am-pass" class="am-pass" autocomplete="current-password" />' +
      '<button type="submit" class="am-submit" id="am-submit">Se connecter</button>' +
      '</form>' +
      '<p class="am-hint" id="am-hint"></p>' +
      '<div class="am-session-actions" id="am-session-actions" style="display:none">' +
      '<p class="am-connected">Édition active&nbsp;: cliquez sur un bloc pour le modifier.</p>' +
      '<button type="button" class="am-logout" id="am-logout">Quitter le mode admin</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);

    q('#am-close', ov).addEventListener('click', closeModal);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) closeModal(); });
    q('#am-logout', ov).addEventListener('click', function () {
      clearSession();
      disableEditMode();
      closeModal();
      flash('Session terminée.');
    });
    q('#am-form', ov).addEventListener('submit', onFormSubmit);
  }
  function closeModal() {
    var ov = q('.am-overlay');
    if (ov) ov.classList.remove('open');
  }
  function openModal(mode) {
    ensureModal();
    var ov = q('.am-overlay');
    ov.classList.add('open');
    modalMode = mode;
    var form = q('#am-form');
    var sessBox = q('#am-session-actions');
    form.style.display = 'none';
    sessBox.style.display = 'none';
    q('#am-hint').textContent = '';

    if (mode === 'session') {
      q('#am-title').textContent = 'Espace admin';
      q('#am-msg').textContent = 'Vous êtes connecté(e).';
      sessBox.style.display = 'block';
      return;
    }
    form.style.display = 'block';
    q('#am-submit').textContent = mode === 'setup' ? 'Créer le mot de passe' : 'Se connecter';
    q('#am-msg').textContent = mode === 'setup'
      ? 'Aucun mot de passe n’est encore défini. Le premier mot de passe saisi deviendra le mot de passe administrateur.'
      : 'Entrez votre mot de passe administrateur.';
    q('#am-hint').textContent = 'La session reste active 48 heures.';
    var input = q('#am-pass');
    input.value = '';
    setTimeout(function () { input.focus(); }, 30);
  }
  function showMsgInModal(text) {
    ensureModal();
    q('#am-hint').textContent = text;
  }

  function onFormSubmit(ev) {
    ev.preventDefault();
    var input = q('#am-pass');
    var password = input.value;
    var btn = q('#am-submit');
    btn.disabled = true;
    btn.textContent = 'Patientez…';

    var request = modalMode === 'setup' ? apiPost('/auth/setup', { password: password })
      : apiPost('/auth/login', { password: password });

    request.then(function (data) {
      storeSession(data.token, data.expiresIn);
      closeModal();
      enableEditMode();
      flash('Connecté(e). Cliquez sur un bloc pour le modifier.');
    }).catch(function (err) {
      showMsgInModal(err.message || 'Erreur de connexion.');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = modalMode === 'setup' ? 'Créer le mot de passe' : 'Se connecter';
    });
  }

  /* ---------------- Bouton Admin ---------------- */
  async function onAdminClick(ev) {
    ev.preventDefault();
    ensureModal();

    var configured = false;
    var apiOk = true;
    try {
      var r = await fetch(API + '/auth', { cache: 'no-store' });
      configured = !!(r.ok && (await r.json()).configured);
    } catch (e) { apiOk = false; }

    if (!apiOk) {
      var ov = q('.am-overlay');
      ov.classList.add('open');
      q('#am-title').textContent = 'Espace admin';
      q('#am-msg').textContent = 'Serveur d’administration injoignable.';
      q('#am-hint').textContent = 'Vérifiez que server.js est lancé (API /api accessible).';
      q('#am-form').style.display = 'none';
      q('#am-session-actions').style.display = 'none';
      return;
    }

    if (readSession()) {
      enableEditMode();
      openModal('session');
    } else if (!configured) {
      openModal('setup');
    } else {
      openModal('login');
    }
  }

  /* ---------------- Notifications ---------------- */
  function flash(message, isError) {
    var old = q('.am-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'am-toast' + (isError ? ' am-toast--error' : '');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 3500);
  }

  /* ---------------- Initialisation ---------------- */
  function boot() {
    var btn = q('#admin-btn');
    if (btn) btn.addEventListener('click', onAdminClick);
    document.addEventListener('click', editDelegate, true);

    // Application du contenu : on (re)lie les blocs éditables
    window.__onContentApplied = attachEditPaths;

    // Session persistante : réactivation automatique si le jeton est valide
    var sess = readSession();
    if (sess) {
      fetch(API + '/me', { headers: { 'Authorization': 'Bearer ' + sess.token }, cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) enableEditMode();
          else clearSession();
        })
        .catch(function () { /* hors ligne : lecture seule */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
