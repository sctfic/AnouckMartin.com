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
  write('backend/data/admin.json', '{"hash":"keep-me"}');
  write('backend/data/uploads/test.png', 'uploaded image');
  write('backend/data/update.lock', 'locked');
  write('incoming/package.json', '{}');
  write('incoming/frontend/index.html', 'new site');
  write('incoming/frontend/content.json', '{"title":"Do not deploy this content"}');
  write('incoming/frontend/admin.js', '// new admin');
  write('incoming/frontend/script.js', '// new script');
  write('incoming/backend/server.js', '// new server');
  write('incoming/backend/deploy.js', '// new deploy');
  write('incoming/backend/storage.js', '// new storage');
  write('incoming/backend/settings.json', '{"private":false}');
  const job = path.join(project, 'backups/updates', 'test');
  fs.mkdirSync(job, { recursive: true });
  const config = { project, dataDir: path.join(project, 'backend/data'), job, port: 0, boot: 'old', pmId: '0' };
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
  assert.equal(f.read('backend/data/admin.json'), '{"hash":"keep-me"}');
  assert.equal(f.read('backend/data/uploads/test.png'), 'uploaded image');
  assert.equal(f.read('frontend/old-photo.jpg'), 'old image');
  assert.equal(f.read('backups/updates/test/previous-frontend/index.html'), 'old site');
  assert.equal(JSON.parse(f.read('backend/data/update-status.json')).state, 'complete');
  const status = JSON.parse(f.read('backend/data/update-status.json'));
  assert.equal(status.stage, 'complete');
  assert.equal(status.backupDirectory, f.config.job);
  assert.equal(status.previousRelease, 'initial');
  assert.equal(status.rollback, 'available');
  assert.equal(fs.existsSync(path.join(f.project, 'backend/data/update.lock')), false);
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
  assert.equal(JSON.parse(f.read('backend/data/release.json')).release, 'initial');
  assert.match(JSON.parse(f.read('backend/data/update-status.json')).message, /restaurée/);
  assert.equal(JSON.parse(f.read('backend/data/update-status.json')).rollback, 'restored');
});

test('code invalide : aucun changement de la version active', async t => {
  const f = fixture(t);
  f.write('incoming/backend/server.js', 'invalid javascript !');
  await deploy(f.config, f.run, async () => { throw new Error('Ne doit pas redémarrer'); });
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/server.js'), '// old server');
  assert.equal(JSON.parse(f.read('backend/data/update-status.json')).state, 'failed');
});

test('interruption pendant la permutation des dossiers : restauration', t => {
  const f = fixture(t);
  f.write('backups/updates/test/frontend/index.html', 'new site');
  f.write('backups/updates/test/backend/server.js', '// new server');
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
  assert.match(JSON.parse(f.read('backend/data/update-status.json')).message, /PM2|service/);
});

test('restauration indisponible : garder le verrou et les sauvegardes', async t => {
  const f = fixture(t);
  await deploy(f.config, f.run, async () => { throw new Error('Serveur indisponible'); });
  assert.equal(f.read('frontend/index.html'), 'old site');
  assert.equal(f.read('backend/data/update.lock'), 'locked');
  assert.equal(JSON.parse(f.read('backend/data/update-status.json')).rollback, 'manual');
  assert.equal(JSON.parse(f.read('backend/data/update-status.json')).state, 'failed');
});


test('rotation : trois journées, dernière version par jour, incidents préservés', t => {
  const f = fixture(t);
  const root = path.join(f.project, 'backups/updates');
  for (const [name, date] of [['a','2026-09-20T08:00:00'], ['b','2026-09-21T08:00:00'], ['c','2026-09-22T08:00:00'], ['d','2026-09-22T09:00:00'], ['e','2026-09-23T08:00:00']]) {
    f.write('backups/updates/' + name + '/transaction.json', JSON.stringify({ state: 'complete', completedAt: date }));
  }
  require('../deploy').pruneUpdates(root);
  assert.deepEqual(fs.readdirSync(root).sort(), ['b','d','e','test']);
});

test('progression Git réelle', () => {
  assert.deepEqual(require('../deploy').parseProgress('Receiving objects:  42% (21/50)\rReceiving objects:  60% (30/50)'), { percent: 60, received: 30, total: 50 });
});

test('échec après installation backend : données privées intactes', t => {
  const f = fixture(t);
  f.write('backups/updates/test/frontend/index.html', 'new site');
  f.write('backups/updates/test/backend/server.js', '// new server');
  assert.throws(() => swapTrees(f.project, f.config.job, name => { if (name === 'backend') throw new Error('Échec'); }));
  assert.equal(f.read('backend/server.js'), '// old server');
  assert.equal(f.read('backend/data/uploads/test.png'), 'uploaded image');
  assert.equal(f.read('backend/data/update.lock'), 'locked');
});

test('migration data et maximum douze sauvegardes de contenu', t => {
  const f = fixture(t);
  const storage = require('../storage');
  // Utiliser un projet indépendant, sans données préexistantes.
  const project = path.join(f.project, 'migration');
  fs.mkdirSync(path.join(project, 'backend'), { recursive: true });
  f.write('migration/data/uploads/photo.png', 'photo');
  const target = storage.runtimeDirectory(project);
  assert.equal(fs.readFileSync(path.join(target, 'uploads/photo.png'), 'utf8'), 'photo');
  assert.equal(fs.existsSync(path.join(project, 'data')), false);
  const backups = path.join(target, 'backups');
  fs.mkdirSync(backups);
  for (let i = 0; i < 15; i++) {
    const file = path.join(backups, 'Content_' + i + '.json');
    fs.writeFileSync(file, '{}');
    fs.utimesSync(file, i + 1, i + 1);
  }
  fs.writeFileSync(path.join(backups, 'other.json'), '{}');
  storage.pruneContentBackups(backups);
  assert.equal(fs.readdirSync(backups).length, 13);
  assert.equal(fs.existsSync(path.join(backups, 'Content_0.json')), false);
  assert.equal(fs.existsSync(path.join(backups, 'Content_14.json')), true);
});

test('migration des anciens déploiements et refus des données concurrentes', t => {
  const f = fixture(t);
  f.write('.deploy/legacy/transaction.json', JSON.stringify({ state: 'complete', completedAt: new Date().toISOString() }));
  f.write('.deploy/legacy/previous-backend/server.js', '// previous');
  require('../deploy').migrateUpdates(f.project);
  assert.equal(f.read('backups/updates/legacy/previous-backend/server.js'), '// previous');
  assert.equal(fs.existsSync(path.join(f.project, '.deploy')), false);
  f.write('data/admin.json', 'legacy');
  assert.throws(() => require('../storage').runtimeDirectory(f.project), /Deux dossiers/);
  assert.equal(f.read('data/admin.json'), 'legacy');
  assert.equal(f.read('backend/data/admin.json'), '{"hash":"keep-me"}');
  f.write('data/update.lock', 'locked');
  assert.throws(() => require('../storage').runtimeDirectory(f.project), /en cours/);
});
