const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { get } = require('./database');
const { setting } = require('./config');

// Authentification du personnel (admin et caissiers). Jeton signé HMAC-SHA256, envoyé dans l'en-tête
// "Authorization: Bearer <jeton>" (et dans l'authentification Socket.IO). Chaque jeton porte son restaurant :
// toutes les requêtes du personnel sont limitées à ce restaurant.

const TOKEN_TTL = { admin: 14 * 24 * 3600, cashier: 12 * 3600 }; // secondes

/** Secret de signature : AUTH_SECRET dans config.env, sinon généré une fois et gardé dans server/.auth-secret */
function loadSecret() {
  const configured = setting('AUTH_SECRET', '');
  if (configured && configured.length >= 16) return configured;
  const file = path.join(__dirname, '.auth-secret');
  try {
    const stored = fs.readFileSync(file, 'utf8').trim();
    if (stored.length >= 16) return stored;
  } catch {
    // pas encore créé
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();

// Copie chiffrée (AES-256-GCM) d'un texte secret, avec une clé dérivée du secret du serveur
const encryptionKey = crypto.createHash('sha256').update(`${SECRET}:cashier-passwords`).digest();

function encryptSecret(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

/** Texte d'origine, ou null si la copie est illisible (secret du serveur changé) */
function decryptSecret(blob) {
  try {
    const [iv, tag, data] = String(blob).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const b64 = (value) => Buffer.from(value).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function issueToken({ role, restaurantId, userId, name }) {
  const body = b64(JSON.stringify({
    role, rid: restaurantId, uid: userId, name, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL[role],
  }));
  return `${body}.${sign(body)}`;
}

/** Contenu d'un jeton valide (signature et date), sinon null. Le compte est vérifié à part (resolveAuth). */
function readToken(token) {
  if (typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.rid || !payload.uid || !TOKEN_TTL[payload.role]) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Le compte doit toujours exister (un caissier désactivé ou supprimé perd l'accès tout de suite, même avec un jeton valide).
const accountCache = new Map(); // "rôle:id" -> { value, at }
const ACCOUNT_TTL_MS = 10 * 1000;

async function loadAccount(payload) {
  const key = `${payload.role}:${payload.uid}`;
  const cached = accountCache.get(key);
  if (cached && Date.now() - cached.at < ACCOUNT_TTL_MS) return cached.value;
  const row = payload.role === 'admin'
    ? await get('SELECT id, name, restaurant_id FROM admins WHERE id = ?', [payload.uid])
    : await get("SELECT id, name, restaurant_id FROM cashiers WHERE id = ? AND status = 'active'", [payload.uid]);
  const value = row && row.restaurant_id === payload.rid
    ? { role: payload.role, id: row.id, name: row.name, restaurantId: row.restaurant_id }
    : null;
  accountCache.set(key, { value, at: Date.now() });
  return value;
}

/** À appeler quand un compte change d'état (désactivé, supprimé) pour couper l'accès sans attendre */
function forgetAccount(role, id) {
  accountCache.delete(`${role}:${id}`);
}

/** { role, id, name, restaurantId } du jeton fourni, ou null */
async function resolveAuth(token) {
  const payload = readToken(token);
  return payload ? loadAccount(payload) : null;
}

const bearerOf = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

const unauthorized = (res) => res.status(401).json({ success: false, error: 'Authentication required', message: 'Please log in again' });
const forbidden = (res) => res.status(403).json({ success: false, error: 'Forbidden', message: 'This action is reserved to the restaurant admin' });

/** Renseigne req.auth (ou null) à partir du jeton ; ne refuse rien lui-même */
async function authenticate(req, res, next) {
  try {
    req.auth = await resolveAuth(bearerOf(req));
    next();
  } catch (error) {
    next(error);
  }
}

const requireStaff = (req, res, next) => (req.auth ? next() : unauthorized(res));
const requireAdmin = (req, res, next) => {
  if (!req.auth) return unauthorized(res);
  return req.auth.role === 'admin' ? next() : forbidden(res);
};
const requireCashier = (req, res, next) => {
  if (!req.auth) return unauthorized(res);
  return req.auth.role === 'cashier' ? next() : forbidden(res);
};

// Limite les essais de connexion répétés (mots de passe devinés) : 10 échecs par quart d'heure et par adresse + identifiant
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function throttleKey(req, identifier) {
  return `${req.ip}|${String(identifier || '').toLowerCase().slice(0, 100)}`;
}

function isThrottled(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.since > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.failures >= MAX_FAILURES;
}

function recordFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.since > WINDOW_MS) attempts.set(key, { failures: 1, since: Date.now() });
  else entry.failures += 1;
}

const clearFailures = (key) => attempts.delete(key);

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now - entry.since > WINDOW_MS) attempts.delete(key);
}, WINDOW_MS).unref();

module.exports = {
  issueToken, readToken, resolveAuth, forgetAccount, authenticate, requireStaff, requireAdmin, requireCashier,
  throttleKey, isThrottled, recordFailure, clearFailures, bearerOf, encryptSecret, decryptSecret,
};
