#!/usr/bin/env node
/* ============================================================
   Anouck Martin — Serveur statique + API d'administration
   ------------------------------------------------------------
   Démarrage :   npm start                 (port 3210)
   Variables :
     ROOT  = dossier public (défaut : ../frontend)
     DATA_DIR = dossier privé (défaut : ../data)
     PORT  = port d'écoute (défaut : 3210)
   L'API est disponible sous /api/ et gère :
     GET  /api/auth        -> { configured }
     POST /api/auth/setup  -> { password }   (1er mot de passe, si aucun)
     POST /api/auth/login  -> { password }
     GET  /api/me          -> authentification persistante (jeton 48 h)
     GET  /api/content     -> contenu actuel
     POST /api/content     -> { content } (jeton requis) + sauvegarde
   Les sauvegardes sont écrites dans <DATA_DIR>/backups/Content_AAAA-MM-JJ.json
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { atomicWrite, revision, imageExtension } = require('./storage');

const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', 'frontend'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PORT = process.env.PORT === undefined ? 3210 : parseInt(process.env.PORT, 10);
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const CONTENT_FILE = path.join(ROOT, 'content.json');
const PROJECT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const UPDATE_LOCK = path.join(DATA_DIR, 'update.lock');
const BOOT = crypto.randomUUID();
const RELEASE = readJsonFile(path.join(DATA_DIR, 'release.json'), { release: 'initial' }).release;
const IMAGE_SLOTS = ['hero', 'artTherapy', 'portrait', 'office', 'email', 'whatsapp'];

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;      // session : 48 h
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/* ---------------- Utilitaires fichiers / JSON ---------------- */
function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}
function writeJsonFile(file, obj) {
  atomicWrite(file, JSON.stringify(obj, null, 2) + '\n');
}
function saveContent(content) {
  JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = 'Content_' + new Date().toISOString().replace(/[:.]/g, '-') + '_' + crypto.randomUUID() + '.json';
  fs.copyFileSync(CONTENT_FILE, path.join(BACKUP_DIR, backup));
  atomicWrite(CONTENT_FILE, JSON.stringify(content, null, 2) + '\n', 0o644);
  return backup;
}
function checkWrite(res, expectedRevision) {
  if (fs.existsSync(UPDATE_LOCK)) {
    sendJson(res, 409, { error: 'Une mise à jour est en cours. Réessayez après son achèvement.' });
    return false;
  }
  const content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  if (expectedRevision !== revision(content)) {
    sendJson(res, 409, { error: 'Le contenu a changé dans une autre session. Rechargez la page avant de modifier à nouveau.' });
    return false;
  }
  return true;
}
function updateAvailability() {
  if (process.env.ENABLE_UPDATES !== '1') return 'La mise à jour doit être activée sur le serveur (ENABLE_UPDATES=1).';
  if (process.platform === 'win32' || !process.env.pm_id) return 'La mise à jour automatique nécessite le serveur Linux géré par PM2.';
  if (ROOT !== path.join(PROJECT, 'frontend')) return 'La racine frontend doit appartenir au projet déployé.';
  const relativeData = path.relative(PROJECT, DATA_DIR);
  if (!relativeData || ['frontend', 'backend'].some(name => relativeData === name || relativeData.startsWith(name + path.sep))) return 'DATA_DIR doit être hors des dossiers de code.';
  return null;
}
function sendJson(res, code, obj, extraHeaders) {
  const body = obj == null ? '' : JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Corps de requête trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

/* ---------------- Authentification ---------------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}
function makeToken(secret) {
  const payload = { sub: 'admin', iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest();
  return toBase64Url(Buffer.from(body)) + '.' + toBase64Url(sig);
}
function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const body = fromBase64Url(parts[0]).toString('utf8');
    const payload = JSON.parse(body);
    const expect = toBase64Url(crypto.createHmac('sha256', secret).update(body).digest());
    if (expect !== parts[1]) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}
function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  return h.slice(0, 7).toLowerCase() === 'bearer ' ? h.slice(7) : null;
}
function isAuthorized(req) {
  const cfg = readJsonFile(ADMIN_FILE, null);
  if (!cfg || !cfg.secret) return false;
  return verifyToken(bearerToken(req), cfg.secret) !== null;
}

/* ---------------- API ---------------- */
async function handleApi(req, res, route) {
  const method = req.method;

  if (route === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true, boot: BOOT, release: RELEASE });

  // Les fichiers téléversés sont publics, mais ne font jamais partie du code déployé.
  if (route.startsWith('/api/media/') && (method === 'GET' || method === 'HEAD')) {
    const name = route.slice('/api/media/'.length);
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(name)) return sendJson(res, 404, { error: 'Image inconnue.' });
    const file = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Image inconnue.' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (route === '/api/update') {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Non autorisé.' });
    const unavailable = updateAvailability();
    if (method === 'GET') return sendJson(res, 200, {
      enabled: !unavailable, reason: unavailable, busy: fs.existsSync(UPDATE_LOCK),
      ...readJsonFile(path.join(DATA_DIR, 'update-status.json'), { state: 'idle', message: '' }),
    });
    if (method === 'POST') {
      if (unavailable) return sendJson(res, 409, { error: unavailable });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      try { fs.writeFileSync(UPDATE_LOCK, BOOT, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (error.code === 'EEXIST') return sendJson(res, 409, { error: 'Une mise à jour est déjà en cours.' });
        throw error;
      }
      try {
        const job = path.join(PROJECT, '.deploy', crypto.randomUUID());
        fs.mkdirSync(job, { recursive: true });
        fs.copyFileSync(path.join(__dirname, 'deploy.js'), path.join(job, 'worker.cjs'));
        const configFile = path.join(job, 'config.json');
        writeJsonFile(configFile, { project: PROJECT, dataDir: DATA_DIR, job, port: server.address().port, boot: BOOT, pmId: process.env.pm_id });
        writeJsonFile(path.join(DATA_DIR, 'update-status.json'), { state: 'running', stage: 'download', backupDirectory: job, at: new Date().toISOString(), message: 'Préparation de la mise à jour…' });
        const child = spawn(process.execPath, [path.join(job, 'worker.cjs'), configFile], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => {
          writeJsonFile(path.join(DATA_DIR, 'update-status.json'), { state: 'failed', message: 'Impossible de lancer la mise à jour.' });
          if (fs.existsSync(UPDATE_LOCK)) fs.unlinkSync(UPDATE_LOCK);
        });
        child.unref();
        return sendJson(res, 202, { ok: true });
      } catch (error) { fs.unlinkSync(UPDATE_LOCK); throw error; }
    }
  }

  if (route === '/api/images' && method === 'POST') {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Non autorisé.' });
    const body = await readBody(req);
    if (!checkWrite(res, body.revision)) return;
    if (!IMAGE_SLOTS.includes(body.slot)) return sendJson(res, 400, { error: 'Emplacement inconnu.' });
    if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) return sendJson(res, 400, { error: 'Image invalide.' });
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.length > 8 * 1024 * 1024) return sendJson(res, 413, { error: 'Image trop volumineuse (8 Mo maximum).' });
    const name = crypto.randomUUID() + '.' + imageExtension(bytes);
    atomicWrite(path.join(UPLOAD_DIR, name), bytes);
    const content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
    content.images = { ...content.images, [body.slot]: '/api/media/' + name };
    const backup = saveContent(content);
    return sendJson(res, 200, { ok: true, content, revision: revision(content), backup });
  }

  // État : un mot de passe est-il déjà défini ?
  if (route === '/api/auth' && method === 'GET') {
    const cfg = readJsonFile(ADMIN_FILE, null);
    return sendJson(res, 200, { configured: !!(cfg && cfg.hash) });
  }

  // Première connexion : création du mot de passe admin
  if (route === '/api/auth/setup' && method === 'POST') {
    const cfg = readJsonFile(ADMIN_FILE, null);
    if (cfg && cfg.hash) return sendJson(res, 409, { error: 'Un mot de passe est déjà configuré.' });
    const body = await readBody(req);
    const password = body && body.password;
    if (fs.existsSync(ADMIN_FILE)) return sendJson(res, 409, { error: 'Un mot de passe est déjà configuré.' });
    if (typeof password !== 'string' || password.length < 4) {
      return sendJson(res, 400, { error: 'Mot de passe trop court (4 caractères minimum).' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    writeJsonFile(ADMIN_FILE, {
      salt: salt,
      hash: hashPassword(password, salt),
      secret: secret,
      createdAt: new Date().toISOString()
    });
    return sendJson(res, 200, { token: makeToken(secret), expiresIn: SESSION_TTL_MS });
  }

  // Connexion
  if (route === '/api/auth/login' && method === 'POST') {
    const cfg = readJsonFile(ADMIN_FILE, null);
    if (!cfg || !cfg.hash) return sendJson(res, 404, { error: 'Aucun mot de passe défini. Première connexion requise.' });
    const body = await readBody(req);
    const password = body && body.password;
    if (typeof password !== 'string' || hashPassword(password, cfg.salt) !== cfg.hash) {
      return sendJson(res, 401, { error: 'Mot de passe incorrect.' });
    }
    return sendJson(res, 200, { token: makeToken(cfg.secret), expiresIn: SESSION_TTL_MS });
  }

  // Vérification de session
  if (route === '/api/me' && method === 'GET') {
    return isAuthorized(req)
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 401, { ok: false });
  }

  // Lecture du contenu
  if (route === '/api/content' && method === 'GET') {
    if (!fs.existsSync(CONTENT_FILE)) return sendJson(res, 404, { error: 'content.json introuvable.' });
    const content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
    return sendJson(res, 200, content, { ETag: '"' + revision(content) + '"' });
  }

  // Enregistrement du contenu (jeton requis)
  if (route === '/api/content' && method === 'POST') {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Non autorisé. Reconnectez-vous.' });
    const body = await readBody(req);
    if (!checkWrite(res, body.revision)) return;
    const content = body && body.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return sendJson(res, 400, { error: 'Contenu invalide (objet JSON attendu).' });
    }

    const backupFile = saveContent(content);
    return sendJson(res, 200, { ok: true, backup: backupFile, revision: revision(content) });
  }

  sendJson(res, 404, { error: 'Route inconnue.' });
}

/* ---------------- Fichiers statiques ---------------- */
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // Ne jamais servir les fichiers sensibles
  if (rel.indexOf('admin.json') !== -1 || rel.indexOf('backups') !== -1) {
    res.writeHead(404); res.end(); return;
  }
  let filePath = path.normalize(path.join(ROOT, rel));
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    res.writeHead(403); res.end(); return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const index = path.join(filePath, 'index.html');
    if (rel.endsWith('/') && fs.existsSync(index)) filePath = index;
    else { res.writeHead(404); res.end(); return; }
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.json') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

/* ---------------- Serveur ---------------- */
const server = http.createServer(async function (req, res) {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const urlPath = decodeURIComponent(parsed.pathname);
    if (urlPath.indexOf('/api/') === 0) {
      await handleApi(req, res, urlPath);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD' }); res.end(); return;
    }
    serveStatic(req, res, urlPath);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 400, { error: err.message || 'Requête invalide.' });
    } else {
      res.end();
    }
  }
});

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('Erreur : le port ' + PORT + ' est déjà utilisé.');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, function () {
  const listeningPort = server.address().port;
  console.log('Serveur Anouck Martin démarré :');
  console.log('  Site      -> http://localhost:' + listeningPort);
  console.log('  API admin -> http://localhost:' + listeningPort + '/api/');
  console.log('  Racine    -> ' + ROOT);
});
