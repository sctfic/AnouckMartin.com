'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exécuter les vrais gestionnaires avec un DOM minimal et une API simulée.
async function adminFixture() {
  const elements = new Map();
  function element() {
    return {
      handlers: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setAttribute() {}, removeAttribute() {}, appendChild() {},
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/index.html'), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set('#' + match[1], element());
  elements.set('#admin-update-btn span', element());
  const session = new Map([['am_admin_session', JSON.stringify({ token: 'test', exp: Date.now() + 60000 })]]);
  const calls = [];
  let reloads = 0;
  let status = { enabled: true, busy: false, state: 'idle' };
  const context = {
    document: {
      readyState: 'complete', body: element(),
      querySelector: selector => elements.get(selector) || null,
      querySelectorAll: () => [], createElement: element, addEventListener() {},
    },
    window: { location: { reload() { reloads++; } } },
    localStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      return { ok: true, status: 200, json: async () => url === '/api/me' ? { ok: true } : options.method === 'POST' ? { ok: true } : status };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/admin.js'), 'utf8'), context);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return {
    elements, session, calls, reloads: () => reloads,
    status(value) { status = value; },
    async click(id) { await elements.get('#' + id).handlers.click({ preventDefault() {} }); await flush(); },
  };
}

test('cadenas connecté : déconnexion immédiate sans demande serveur ni modale', async () => {
  const f = await adminFixture();
  const before = f.calls.length;
  await f.click('admin-btn');
  assert.equal(f.session.has('am_admin_session'), false);
  assert.equal(f.elements.get('#admin-update-btn').hidden, true);
  assert.equal(f.calls.length, before);
});

test('appliquer lance une mise à jour puis recharge après succès', async () => {
  const f = await adminFixture();
  f.status({ enabled: true, busy: false, state: 'complete', stage: 'complete' });
  await f.click('admin-update-btn');
  assert.equal(f.reloads(), 0, 'Un ancien succès ne doit pas recharger la page');
  assert.equal(f.calls.some(call => call.method === 'POST'), false, 'Ouvrir la fenêtre ne lance pas de mise à jour');
  await f.click('am-update');
  assert.equal(f.calls.filter(call => call.url === '/api/update' && call.method === 'POST').length, 1);
  assert.equal(f.reloads(), 1);
});

test('échec de mise à jour : conserver le diagnostic sans recharger', async () => {
  const f = await adminFixture();
  f.status({ enabled: true, busy: false, state: 'failed', rollback: 'restored' });
  await f.click('am-update');
  assert.equal(f.reloads(), 0);
  assert.equal(f.elements.get('#am-update-recovery').open, true);
});
