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

const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', 'frontend'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PORT = process.env.PORT === undefined ? 3210 : parseInt(process.env.PORT, 10);
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const CONTENT_FILE = path.join(ROOT, 'content.json');

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;      // session : 48 h
const BACKUP_AFTER_MS = 12 * 60 * 60 * 1000;     // sauvegarde si fichier modifié il y a > 12 h
const MAX_BODY = 5 * 1024 * 1024;

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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
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
    return sendJson(res, 200, readJsonFile(CONTENT_FILE, null));
  }

  // Enregistrement du contenu (jeton requis)
  if (route === '/api/content' && method === 'POST') {
    if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Non autorisé. Reconnectez-vous.' });
    const body = await readBody(req);
    const content = body && body.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return sendJson(res, 400, { error: 'Contenu invalide (objet JSON attendu).' });
    }

    let backupFile = null;
    if (fs.existsSync(CONTENT_FILE)) {
      const stat = fs.statSync(CONTENT_FILE);
      if (Date.now() - stat.mtimeMs > BACKUP_AFTER_MS) {
        const d = new Date();
        const stamp = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const name = 'Content_' + stamp + '.json';
        fs.writeFileSync(path.join(BACKUP_DIR, name), fs.readFileSync(CONTENT_FILE));
        backupFile = name;
      }
    }
    fs.writeFileSync(CONTENT_FILE, JSON.stringify(content, null, 2) + '\n');
    return sendJson(res, 200, { ok: true, backup: backupFile });
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
  const parsed = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(parsed.pathname);

  try {
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
