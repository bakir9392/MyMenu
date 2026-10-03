const crypto = require('crypto');
const { db } = require('./database');

// Une session sans activité depuis ce délai est considérée terminée (client parti sans payer, oubli...)
const SESSION_IDLE_HOURS = 3;

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ changes: this.changes });
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const newToken = (bytes) => crypto.randomBytes(bytes).toString('base64url');

function expireIdleSessions() {
  return run(
    `UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE status = 'open' AND last_activity < datetime('now', ?)`,
    [`-${SESSION_IDLE_HOURS} hours`]
  );
}

/**
 * Appelé quand le client arrive via le QR code de la table.
 * Si la table a déjà une session ouverte (même groupe), il la rejoint ; sinon une nouvelle session est créée.
 * Retourne null si le QR code ne correspond à aucune table.
 */
async function startSessionFromQr(qrToken) {
  const table = await get('SELECT number FROM restaurant_tables WHERE qr_token = ?', [qrToken]);
  if (!table) return null;

  await expireIdleSessions();

  const open = await get(
    `SELECT token FROM table_sessions WHERE table_number = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    [table.number]
  );
  if (open) {
    await touchSession(open.token);
    return { token: open.token, tableNumber: table.number };
  }

  const token = newToken(24);
  await run('INSERT INTO table_sessions (token, table_number) VALUES (?, ?)', [token, table.number]);
  return { token, tableNumber: table.number };
}

/** Session ouverte correspondant au token, ou null si inconnue / terminée. */
async function getOpenSession(token) {
  if (!token || typeof token !== 'string') return null;
  await expireIdleSessions();
  const session = await get(
    `SELECT token, table_number FROM table_sessions WHERE token = ? AND status = 'open'`,
    [token]
  );
  return session ? { token: session.token, tableNumber: session.table_number } : null;
}

function touchSession(token) {
  return run('UPDATE table_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?', [token]);
}

/** Termine la session ouverte de la table (paiement). Retourne le nombre de sessions fermées. */
async function closeTableSession(tableNumber) {
  const { changes } = await run(
    `UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE table_number = ? AND status = 'open'`,
    [String(tableNumber)]
  );
  return changes;
}

async function listTables() {
  await expireIdleSessions();
  const rows = await all(`
    SELECT t.number, t.qr_token, t.created_at,
           EXISTS (SELECT 1 FROM table_sessions s WHERE s.table_number = t.number AND s.status = 'open') AS has_open_session
    FROM restaurant_tables t
  `);
  return rows
    .map((row) => ({ ...row, has_open_session: !!row.has_open_session }))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** Crée les tables manquantes parmi `numbers` (les tables existantes gardent leur QR code). */
async function createTables(numbers) {
  for (const number of numbers) {
    await run('INSERT OR IGNORE INTO restaurant_tables (number, qr_token) VALUES (?, ?)', [number, newToken(9)]);
  }
}

/** Nouveau QR code pour la table : l'ancien (imprimé ou photographié) ne fonctionne plus. */
async function regenerateTableQr(number) {
  const { changes } = await run('UPDATE restaurant_tables SET qr_token = ? WHERE number = ?', [newToken(9), number]);
  return changes > 0;
}

async function deleteTable(number) {
  await closeTableSession(number);
  const { changes } = await run('DELETE FROM restaurant_tables WHERE number = ?', [number]);
  return changes > 0;
}

module.exports = {
  startSessionFromQr,
  getOpenSession,
  touchSession,
  closeTableSession,
  listTables,
  createTables,
  regenerateTableQr,
  deleteTable,
};
