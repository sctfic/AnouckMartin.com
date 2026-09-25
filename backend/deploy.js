'use strict';
// Ce fichier autonome est copié hors du code actif avant son exécution.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function removeChild(root, target) {
  root = path.resolve(root);
  target = path.resolve(target);
  if (path.dirname(target) !== root || fs.lstatSync(root).isSymbolicLink()) throw new Error('Suppression hors du dossier autorisé refusée.');
  fs.rmSync(target, { recursive: true, force: true });
}

function pruneUpdates(root) {
  if (!fs.existsSync(root)) return;
  const versions = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(entry => {
    const dir = path.join(root, entry.name);
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, 'transaction.json'), 'utf8'));
      if (info.state !== 'complete') return [];
      const time = new Date(info.completedAt || fs.statSync(path.join(dir, 'transaction.json')).mtime).getTime();
      if (!Number.isFinite(time)) return [];
      const date = new Date(time);
      const day = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
      return [{ dir, time, day }];
    } catch (_) { return []; } // ne jamais purger une restauration non résolue
  }).sort((a, b) => b.time - a.time);
  const days = new Set();
  for (const version of versions) {
    if (days.has(version.day) || days.size >= 3) removeChild(root, version.dir);
    else days.add(version.day);
  }
}

function migrateUpdates(project) {
  const old = path.join(project, '.deploy');
  const target = path.join(project, 'backups', 'updates');
  if (!fs.existsSync(old)) { pruneUpdates(target); return; }
  if (fs.lstatSync(old).isSymbolicLink()) throw new Error('Migration : dossier .deploy symbolique refusé.');
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(old)) {
    if (fs.existsSync(path.join(target, name))) throw new Error('Sauvegarde déjà présente : ' + name);
    fs.renameSync(path.join(old, name), path.join(target, name));
  }
  fs.rmdirSync(old);
  pruneUpdates(target);
}

function parseProgress(text) {
  const matches = [...text.matchAll(/Receiving objects:\s*(\d+)%\s*\((\d+)\/(\d+)\)/g)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  return { percent: Number(match[1]), received: Number(match[2]), total: Number(match[3]) };
}

async function cloneSource(checkout, onProgress, run) {
  const args = ['clone', '--progress', '--depth', '1', '--single-branch', '--branch', 'main',
    'https://github.com/sctfic/AnouckMartin.com.git', checkout];
  const options = { timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } };
  if (run !== exec) return run('git', args, options);
  await new Promise((resolve, reject) => {
    let tail = '';
    const child = execFile('git', args, options, error => error ? reject(error) : resolve());
    child.stderr.on('data', chunk => {
      tail = (tail + chunk.toString()).slice(-4096);
      const progress = parseProgress(tail);
      if (progress) onProgress(progress);
    });
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

function files(directory, prefix = '', skipData = false) {
  if (!fs.existsSync(directory)) return [];
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Dossier symbolique refusé.');
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (skipData && !prefix && entry.name === 'data') return [];
    const name = path.join(prefix, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Lien ou fichier spécial refusé : ' + name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), name, skipData) : [name];
  });
}

function prepareTree(source, live, stage) {
  fs.mkdirSync(stage, { recursive: true });
  // Le code GitHub ne remplace AUCUN JSON, même imbriqué.
  const backend = path.basename(live) === 'backend';
  for (const name of files(source, '', backend)) {
    if (path.extname(name).toLowerCase() === '.json') continue;
    const dest = path.join(stage, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(source, name), dest);
  }
  for (const name of files(live, '', backend)) {
    const extension = path.extname(name).toLowerCase();
    // Garder aussi les anciennes images référencées par le JSON conservé.
    if (extension !== '.json' && !['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(extension)) continue;
    const bytes = fs.readFileSync(path.join(live, name));
    if (extension === '.json') JSON.parse(bytes.toString('utf8')); // Refuser un JSON déjà endommagé.
    const dest = path.join(stage, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
}

function swapTrees(project, job, afterSwap = () => {}) {
  const moved = [];
  try {
    for (const name of ['frontend', 'backend']) {
      const live = path.join(project, name);
      const backup = path.join(job, 'previous-' + name);
      if (name === 'backend') {
        // Garder backend/data au même emplacement pendant toute l'opération.
        fs.mkdirSync(backup, { recursive: true });
        moved.push(name);
        writeJson(path.join(job, 'backend-swap.json'), { phase: 'moving' });
        for (const entry of fs.readdirSync(live)) {
          if (entry !== 'data') fs.renameSync(path.join(live, entry), path.join(backup, entry));
        }
        writeJson(path.join(job, 'backend-swap.json'), { phase: 'installing' });
        for (const entry of fs.readdirSync(path.join(job, name))) {
          if (entry === 'data') throw new Error('Les données ne doivent pas faire partie du code préparé.');
          fs.renameSync(path.join(job, name, entry), path.join(live, entry));
        }
        afterSwap(name);
        continue;
      }
      fs.renameSync(live, backup);
      moved.push(name);
      fs.renameSync(path.join(job, name), live);
      afterSwap(name);
    }
  } catch (error) {
    try { restoreTrees(project, job, moved); }
    catch (restoreError) {
      restoreError.needsRecovery = true;
      throw restoreError;
    }
    throw error;
  }
}

function restoreTrees(project, job, names = ['frontend', 'backend']) {
  for (const name of [...names].reverse()) {
    const live = path.join(project, name);
    const previous = path.join(job, 'previous-' + name);
    if (!fs.existsSync(previous)) continue;
    if (name === 'backend' && fs.existsSync(path.join(job, 'backend-swap.json'))) {
      const phase = JSON.parse(fs.readFileSync(path.join(job, 'backend-swap.json'), 'utf8')).phase;
      if (phase === 'installing') {
        const failed = path.join(job, 'failed-backend-' + crypto.randomUUID());
        fs.mkdirSync(failed);
        for (const entry of fs.readdirSync(live)) {
          if (entry !== 'data') fs.renameSync(path.join(live, entry), path.join(failed, entry));
        }
      }
      for (const entry of fs.readdirSync(previous)) fs.renameSync(path.join(previous, entry), path.join(live, entry));
      fs.rmdirSync(previous);
      continue;
    }
    if (fs.existsSync(live)) fs.renameSync(live, path.join(job, 'failed-' + name + '-' + crypto.randomUUID()));
    fs.renameSync(previous, live);
  }
}

async function waitHealthy(port, release, oldBoot) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(1500) });
      const data = await response.json();
      if (response.ok && data.release === release && data.boot !== oldBoot) return;
    } catch (_) { /* PM2 redémarre le serveur. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Le serveur mis à jour ne répond pas correctement.');
}

async function deploy(config, run = exec, healthy = waitHealthy) {
  const { project, dataDir, job, port, boot, pmId } = config;
  const statusFile = path.join(dataDir, 'update-status.json');
  const marker = path.join(dataDir, 'release.json');
  const oldRelease = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : { release: 'initial' };
  const details = { backupDirectory: job, previousRelease: oldRelease.release, stage: 'download' };
  const status = (state, message, extra = {}) => {
    Object.assign(details, extra);
    writeJson(statusFile, { ...details, state, message, at: new Date().toISOString() });
  };
  let lastStageAt = Date.now();
  const stage = async (state, message, extra) => {
    await delay(Math.max(0, 600 - (Date.now() - lastStageAt)));
    status(state, message, extra);
    lastStageAt = Date.now();
  };
  let swapped = false;
  let keepLock = false;
  const restart = () => run('pm2', ['restart', String(pmId), '--no-treekill'], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  try {
    const pm2List = await run('pm2', ['jlist'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const processes = JSON.parse(pm2List.stdout);
    const managed = processes.find(item => String(item.pm_id) === String(pmId));
    const expectedScript = path.join(project, 'backend', 'server.js');
    if (!managed || managed.pm2_env.pm_exec_path !== expectedScript || managed.pm2_env.watch ||
        managed.pm2_env.treekill !== false || managed.pm2_env.exec_mode !== 'fork_mode' ||
        processes.filter(item => item.pm2_env.pm_exec_path === expectedScript).length !== 1) {
      throw new Error('Recréez le service avec ecosystem.config.js : une instance fork, watch désactivé et treekill=false sont requis.');
    }
    status('running', 'Téléchargement du code depuis GitHub…');
    const checkout = path.join(job, 'source');
    await cloneSource(checkout, progress => status('running', 'Téléchargement du code depuis GitHub…', { download: progress }), run);
    status('running', 'Téléchargement terminé.', { download: { ...details.download, percent: 100 } });
    const { stdout } = await run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { timeout: 10000, windowsHide: true });
    const release = stdout.trim();
    // Les changements de dépendances nécessitent une installation explicite.
    const incoming = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
    const current = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    for (const key of ['dependencies', 'optionalDependencies', 'type', 'engines']) {
      if (JSON.stringify(incoming[key] || null) !== JSON.stringify(current[key] || null)) {
        throw new Error('La version GitHub modifie les dépendances ou Node.js : installation manuelle nécessaire.');
      }
    }
    for (const name of ['frontend', 'backend']) {
      prepareTree(path.join(checkout, name), path.join(project, name), path.join(job, name));
    }
    for (const required of ['frontend/index.html', 'frontend/admin.js', 'frontend/script.js', 'backend/server.js', 'backend/deploy.js', 'backend/storage.js']) {
      if (!fs.existsSync(path.join(job, required))) throw new Error('Version GitHub incompatible : ' + required + ' manque.');
    }
    await stage('running', 'Vérification du code…', { stage: 'validate', release });
    for (const name of ['frontend', 'backend']) {
      for (const file of files(path.join(job, name))) {
        if (file.endsWith('.js')) await run(process.execPath, ['--check', path.join(job, name, file)], { timeout: 15000, windowsHide: true });
      }
    }
    writeJson(path.join(job, 'transaction.json'), { project, release, oldRelease, state: 'prepared' });
    await stage('running', 'Sauvegarde et installation des nouveaux dossiers…', { stage: 'install' });
    swapTrees(project, job);
    swapped = true;
    writeJson(marker, { release });
    await stage('restarting', 'Redémarrage du serveur…', { release, stage: 'restart', rollback: 'available' });
    await restart();
    await stage('restarting', 'Vérification du site après redémarrage…', { stage: 'health' });
    await healthy(port, release, boot);
    writeJson(path.join(job, 'transaction.json'), { project, release, oldRelease, state: 'complete', completedAt: new Date().toISOString() });
    // Les sources Git temporaires ne constituent pas une sauvegarde.
    // Une erreur de ménage ne doit jamais annuler une version déjà validée.
    try {
      removeChild(job, checkout);
      pruneUpdates(path.dirname(job));
    } catch (cleanupError) { details.cleanupWarning = cleanupError.message; }
    await stage('complete', 'Frontend et backend mis à jour. Textes, JSON et images conservés.', { release, stage: 'complete' });
    await delay(600);
  } catch (error) {
    if (error.needsRecovery) {
      keepLock = true;
      status('failed', 'Restauration à terminer sur le serveur.', { rollback: 'manual' });
    }
    if (swapped) {
      try {
        status('restarting', 'Échec de la nouvelle version. Restauration de la version précédente…', { stage: 'restart' });
        restoreTrees(project, job);
        writeJson(marker, oldRelease);
        await restart();
        await healthy(port, oldRelease.release, boot);
      } catch (rollbackError) {
        keepLock = true;
        status('failed', 'Restauration à terminer sur le serveur.', { rollback: 'manual' });
      }
    }
    if (!keepLock) status('failed', swapped ? 'Échec de la mise à jour ; version précédente restaurée. ' + error.message.split('\n')[0] : 'Mise à jour annulée ; fichiers actuels conservés. ' + error.message.split('\n')[0], { rollback: swapped ? 'restored' : 'not-needed' });
  } finally {
    if (!keepLock && fs.existsSync(path.join(dataDir, 'update.lock'))) fs.unlinkSync(path.join(dataDir, 'update.lock'));
    if (!keepLock && fs.existsSync(job)) {
      const result = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (result.state === 'failed') {
        writeJson(statusFile, { ...result, backupDirectory: null });
        removeChild(path.dirname(job), job);
      }
    }
  }
}

module.exports = { prepareTree, swapTrees, restoreTrees, files, deploy, pruneUpdates, migrateUpdates, parseProgress };
if (require.main === module) {
  deploy(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
