'use strict';
// Ce fichier autonome est copié hors du code actif avant son exécution.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

function files(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Dossier symbolique refusé.');
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(prefix, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Lien ou fichier spécial refusé : ' + name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), name) : [name];
  });
}

function prepareTree(source, live, stage) {
  fs.mkdirSync(stage, { recursive: true });
  // Le code GitHub ne remplace AUCUN JSON, même imbriqué.
  for (const name of files(source)) {
    if (path.extname(name).toLowerCase() === '.json') continue;
    const dest = path.join(stage, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(source, name), dest);
  }
  for (const name of files(live)) {
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
    await run('git', ['clone', '--depth', '1', '--single-branch', '--branch', 'main',
      'https://github.com/sctfic/AnouckMartin.com.git', checkout], {
      timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
    });
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
    status('running', 'Vérification du code…', { stage: 'validate', release });
    for (const name of ['frontend', 'backend']) {
      for (const file of files(path.join(job, name))) {
        if (file.endsWith('.js')) await run(process.execPath, ['--check', path.join(job, name, file)], { timeout: 15000, windowsHide: true });
      }
    }
    writeJson(path.join(job, 'transaction.json'), { project, release, oldRelease, state: 'prepared' });
    status('running', 'Sauvegarde et installation des nouveaux dossiers…', { stage: 'install' });
    swapTrees(project, job);
    swapped = true;
    writeJson(marker, { release });
    status('restarting', 'Redémarrage du serveur…', { release, stage: 'restart', rollback: 'available' });
    await restart();
    status('restarting', 'Vérification du site après redémarrage…', { stage: 'health' });
    await healthy(port, release, boot);
    writeJson(path.join(job, 'transaction.json'), { project, release, oldRelease, state: 'complete' });
    status('complete', 'Frontend et backend mis à jour. Textes, JSON et images conservés.', { release, stage: 'complete' });
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
  }
}

module.exports = { prepareTree, swapTrees, restoreTrees, files, deploy };
if (require.main === module) {
  deploy(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
