'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function atomicWrite(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temporary, 'wx', mode);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function revision(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
function imageExtension(bytes) {
  if (bytes.length > 12 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
      bytes.subarray(-2).equals(Buffer.from([255, 217]))) return 'jpg';
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (bytes.length > 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('Image invalide. Formats acceptés : JPEG, PNG ou WebP.');
}
function pruneContentBackups(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^Content_.*\.json$/.test(entry.name))
    .map(entry => ({ name: entry.name, time: fs.statSync(path.join(directory, entry.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  for (const entry of entries.slice(12)) fs.unlinkSync(path.join(directory, entry.name));
}

function runtimeDirectory(project, configured) {
  const legacy = path.join(project, 'data');
  const target = path.join(project, 'backend', 'data');
  const requested = path.resolve(configured || target);
  if (requested !== legacy && requested !== target) return requested;
  for (const directory of [legacy, target]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Migration : dossier de données symbolique refusé.');
  }
  if (fs.existsSync(legacy)) {
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Deux dossiers de données existent. Fusion manuelle nécessaire pour préserver les données.');
    // L'ancien worker doit retrouver son verrou, son état et release.json au
    // même endroit après le redémarrage. Reporter la migration au prochain
    // démarrage sans verrou, sans interrompre le service ni déplacer ses données.
    if (fs.existsSync(path.join(legacy, 'update.lock'))) return legacy;
    if (fs.existsSync(target)) fs.rmdirSync(target); // uniquement un dossier vide
    fs.renameSync(legacy, target);
  }
  return target;
}
module.exports = { atomicWrite, revision, imageExtension, pruneContentBackups, runtimeDirectory };
