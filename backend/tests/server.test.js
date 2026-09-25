'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('frontend public, backend privé et administration', { timeout: 20000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anouck-test-'));
  const project = path.resolve(__dirname, '../..');
  const publicDir = path.join(temporary, 'frontend');
  const privateDir = path.join(temporary, 'data');
  let child;
  try {
    await fs.cp(path.join(project, 'frontend'), publicDir, { recursive: true });
    child = spawn(process.execPath, [path.join(project, 'backend/server.js')], {
      cwd: temporary,
      env: { ...process.env, PORT: '0', ROOT: publicDir, DATA_DIR: privateDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = await new Promise((resolve, reject) => {
      let output = '';
      let errors = '';
      const timer = setTimeout(() => reject(new Error('Serveur indisponible : ' + errors)), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Sortie serveur : ' + code + errors)); });
      child.stderr.on('data', chunk => { errors += chunk; });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve('http://localhost:' + match[1]); }
      });
    });
    const request = (url, options) => fetch(base + url, options);
    const post = (url, body, token) => request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    for (const url of ['/', '/style.css', '/script.js', '/admin.js', '/content.json', '/hero-bg-joyful.png', '/photo-anouck.jpeg']) {
      const response = await request(url);
      assert.equal(response.status, 200, url);
      await response.arrayBuffer();
    }
    assert.deepEqual(await (await request('/api/auth')).json(), { configured: false });
    assert.equal((await post('/api/content', { content: {} })).status, 401);
    const setup = await post('/api/auth/setup', { password: 'test-password-only' });
    assert.equal(setup.status, 200);
    const { token } = await setup.json();
    assert.ok(JSON.parse(await fs.readFile(path.join(privateDir, 'admin.json'), 'utf8')).hash);
    assert.equal((await post('/api/auth/login', { password: 'incorrect' })).status, 401);
    assert.equal((await post('/api/auth/login', { password: 'test-password-only' })).status, 200);
    assert.equal((await request('/api/me', { headers: { Authorization: 'Bearer ' + token } })).status, 200);
    const original = await (await request('/api/content')).json();
    const updated = structuredClone(original);
    updated.hero.title = 'Modification de test';
    const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000);
    await fs.utimes(path.join(publicDir, 'content.json'), oldDate, oldDate);
    const saved = await post('/api/content', { content: updated }, token);
    assert.equal(saved.status, 200);
    const { backup } = await saved.json();
    assert.ok(backup);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(privateDir, 'backups', backup), 'utf8')), original);
    assert.deepEqual(await (await request('/content.json')).json(), updated);
    for (const url of ['/backend/server.js', '/server.js', '/package.json', '/data/admin.json', '/admin.json', '/backups/' + backup, '/data/backups/' + backup]) {
      assert.equal((await request(url)).status, 404, url);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    // Vérifier la cible avant toute suppression récursive.
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('anouck-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
