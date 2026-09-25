'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { deploy, swapTrees } = require('../deploy');

function fixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'anouck-deploy-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(project)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(project).startsWith('anouck-deploy-'));
    fs.rmSync(project, { recursive: true, force: true });
  });
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), data);
  };
  write('package.json', '{}');
  write('frontend/index.html', 'old site');
  write('frontend/content.json', '{ "title": "Texte de production", "images": {"office":"/api/media/test.png"} }\n');
  write('frontend/old-photo.jpg', 'old image');
  write('backend/server.js', '// old server');
  write('backend/settings.json', '{ "private": true }\n');
  write('data/admin.json', '{"hash":"keep-me"}');
  write('data/uploads/test.png', 'uploaded image');
  write('data/update.lock', 'locked');
  write('incoming/package.json', '{}');
  write('incoming/frontend/index.html', 'new site');
  write('incoming/frontend/content.json', '{"title":"Do not deploy this content"}');
  write('incoming/frontend/admin.js', '// new admin');
  write('incoming/frontend/script.js', '// new script');
  write('incoming/backend/server.js', '// new server');
  write('incoming/backend/deploy.js', '// new deploy');
  write('incoming/backend/storage.js', '// new storage');
  write('incoming/backend/settings.json', '{"private":false}');
  const job = path.join(project, '.deploy', 'test');
  fs.mkdirSync(job, { recursive: true });
  const config = { project, dataDir: path.join(project, 'data'), job, port: 0, boot: 'old', pmId: '0' };
  const run = async (command, args, options) => {
    if (command === 'git' && args[0] === 'clone') {
      fs.cpSync(path.join(project, 'incoming'), args.at(-1), { recursive: true });
      return { stdout: '' };
    }
    if (command === 'git') return { stdout: 'abc123\n' };
    if (command === 'pm2' && args[0] === 'jlist') return { stdout: JSON.stringify([
      { pm_id: 0, pm2_env: { pm_exec_path: path.join(project, 'backend/server.js'), watch: false, treekill: false, exec_mode: 'fork_mode' } },
    ]) };
    if (command === 'pm2') return { stdout: '' };
    return exec(command, args, options);
  };
  return { project, config, run, write, read: file => fs.readFileSync(path.join(project, file), 'utf8') };
}

test('mise à jour conserve exactement tous les JSON et les images', async t => {
  const f = fixture(t);
  const content = f.read('frontend/content.json');
  const settings = f.read('backend/settings.json');
  await deploy(f.config, f.run, async () => {});
  assert.equal(f.read('frontend/index.html'), 'new site');
  assert.equal(f.read('backend/server.js'), '// new server');
  assert.equal(f.read('frontend/content.json'), content);
  assert.equal(f.read('backend/settings.json'), settings);
  assert.equal(f.read('data/admin.json'), '{"hash":"keep-me"}');
  assert.equal(f.read('data/uploads/test.png'), 'uploaded image');
  assert.equal(f.read('frontend/old-photo.jpg'), 'old image');
  assert.equal(f.read('.deploy/test/previous-frontend/index.html'), 'old site');
  assert.equal(JSON.parse(f.read('data/update-status.json')).state, 'complete');
  const status = JSON.parse(f.read('data/update-status.json'));
  assert.equal(status.stage, 'complete');
  assert.equal(status.backupDirectory, f.config.job);
  assert.equal(status.previousRelease, 'initial');
  assert.equal(status.rollback, 'available');
  assert.equal(fs.existsSync(path.join(f.project, 'data/update.lock')), false);
});

test('échec au redémarrage : retour à la version précédente', async t => {
  const f = fixture(t);
  const content = f.read('frontend/content.json');
  await deploy(f.config, f.run, async (port, release) => {
    if (release === 'abc123') throw new Error('Nouvelle version indisponible');
  });
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/server.js'), '// old server');
  assert.equal(f.read('frontend/content.json'), content);
  assert.equal(JSON.parse(f.read('data/release.json')).release, 'initial');
  assert.match(JSON.parse(f.read('data/update-status.json')).message, /restaurée/);
  assert.equal(JSON.parse(f.read('data/update-status.json')).rollback, 'restored');
});

test('code invalide : aucun changement de la version active', async t => {
  const f = fixture(t);
  f.write('incoming/backend/server.js', 'invalid javascript !');
  await deploy(f.config, f.run, async () => { throw new Error('Ne doit pas redémarrer'); });
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/server.js'), '// old server');
  assert.equal(JSON.parse(f.read('data/update-status.json')).state, 'failed');
});

test('interruption pendant la permutation des dossiers : restauration', t => {
  const f = fixture(t);
  f.write('.deploy/test/frontend/index.html', 'new site');
  f.write('.deploy/test/backend/server.js', '// new server');
  assert.throws(() => swapTrees(f.project, f.config.job, () => { throw new Error('Échec simulé'); }));
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/server.js'), '// old server');
});

test('configuration PM2 incompatible : arrêt avant toute copie', async t => {
  const f = fixture(t);
  await deploy(f.config, async (command, args, options) => {
    if (command === 'pm2' && args[0] === 'jlist') return { stdout: '[]' };
    return f.run(command, args, options);
  }, async () => {});
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/server.js'), '// old server');
  assert.match(JSON.parse(f.read('data/update-status.json')).message, /PM2|service/);
});

test('restauration indisponible : garder le verrou et les sauvegardes', async t => {
  const f = fixture(t);
  await deploy(f.config, f.run, async () => { throw new Error('Serveur indisponible'); });
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('data/update.lock'), 'locked');
  assert.equal(JSON.parse(f.read('data/update-status.json')).rollback, 'manual');
  assert.equal(JSON.parse(f.read('data/update-status.json')).state, 'failed');
});
