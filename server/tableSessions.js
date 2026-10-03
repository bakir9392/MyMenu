const crypto = require('crypto');
const { run, get, all } = require('./database');

// Tables et sessions de table d'un restaurant. Une table se désigne par (restaurant, numéro) ; une session
// par son jeton, qui est secret et aléatoire : il retrouve à lui seul le restaurant et la table.

// Une session sans activité depuis ce délai est considérée terminée (client parti sans payer, oubli...)
const SESSION_IDLE_HOURS = 3;

const newToken = (bytes) => crypto.randomBytes(bytes).toString('base64url');

function expireIdleSessions() {
  return run(
    `UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE status = 'open' AND last_activity < UTC_TIMESTAMP() - INTERVAL ? HOUR`,
    [SESSION_IDLE_HOURS]
  );
}

const toSession = (row) => (row ? { token: row.token, tableNumber: row.table_number, restaurantId: row.restaurant_id } : null);

/**
 * Appelé quand le client arrive via le QR code de la table.
 * Si la table a déjà une session ouverte (même groupe), il la rejoint ; sinon une nouvelle session est créée.
 * Retourne null si le QR code ne correspond à aucune table.
 */
async function startSessionFromQr(qrToken) {
  const table = await get('SELECT restaurant_id, number FROM restaurant_tables WHERE qr_token = ?', [qrToken]);
  if (!table) return null;

  await expireIdleSessions();

  const open = await get(
    `SELECT token FROM table_sessions WHERE restaurant_id = ? AND table_number = ? AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [table.restaurant_id, table.number]
  );
  if (open) {
    await touchSession(open.token);
    return { token: open.token, tableNumber: table.number, restaurantId: table.restaurant_id, created: false };
  }

  const token = newToken(24);
  await run('INSERT INTO table_sessions (token, restaurant_id, table_number) VALUES (?, ?, ?)', [token, table.restaurant_id, table.number]);
  return { token, tableNumber: table.number, restaurantId: table.restaurant_id, created: true };
}

/** Session ouverte correspondant au token, ou null si inconnue / terminée. */
async function getOpenSession(token) {
  if (!token || typeof token !== 'string') return null;
  await expireIdleSessions();
  return toSession(await get(
    `SELECT token, restaurant_id, table_number FROM table_sessions WHERE token = ? AND status = 'open'`,
    [token]
  ));
}

function touchSession(token) {
  return run('UPDATE table_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?', [token]);
}

/**
 * Visite en cours, ou terminée (encaissée) depuis moins de `hours` heures : un client peut encore
 * envoyer une réclamation ou enregistrer son addition juste après avoir payé.
 */
async function getRecentSession(token, hours = 3) {
  if (!token || typeof token !== 'string') return null;
  return toSession(await get(
    `SELECT token, restaurant_id, table_number FROM table_sessions
     WHERE token = ? AND (status = 'open' OR closed_at >= UTC_TIMESTAMP() - INTERVAL ? HOUR)`,
    [token, Number(hours)]
  ));
}

/** Session ouverte d'une table (la visite en cours), ou null */
async function getOpenSessionForTable(restaurantId, tableNumber) {
  await expireIdleSessions();
  return toSession(await get(
    `SELECT token, restaurant_id, table_number FROM table_sessions
     WHERE restaurant_id = ? AND table_number = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    [restaurantId, String(tableNumber)]
  ));
}

/** Termine une visite précise. Retourne true si elle était ouverte. */
async function closeSession(token) {
  const { changes } = await run(
    `UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE token = ? AND status = 'open'`,
    [token]
  );
  return changes > 0;
}

/** Termine la session ouverte de la table (suppression de la table). */
async function closeTableSession(restaurantId, tableNumber) {
  const { changes } = await run(
    `UPDATE table_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE restaurant_id = ? AND table_number = ? AND status = 'open'`,
    [restaurantId, String(tableNumber)]
  );
  return changes;
}

async function listTables(restaurantId) {
  await expireIdleSessions();
  const rows = await all(
    `SELECT t.number, t.qr_token, t.tax_rate, t.created_at,
            EXISTS (SELECT 1 FROM table_sessions s
                    WHERE s.restaurant_id = t.restaurant_id AND s.table_number = t.number AND s.status = 'open') AS has_open_session
     FROM restaurant_tables t WHERE t.restaurant_id = ?`,
    [restaurantId]
  );
  return rows
    .map((row) => ({ ...row, has_open_session: !!row.has_open_session }))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** Crée les tables manquantes parmi `numbers` (les tables existantes gardent leur QR code ; `taxRate` : TVA des nouvelles tables, null = taux du restaurant). */
async function createTables(restaurantId, numbers, taxRate = null) {
  for (const number of numbers) {
    await run('INSERT IGNORE INTO restaurant_tables (restaurant_id, number, qr_token, tax_rate) VALUES (?, ?, ?, ?)', [restaurantId, number, newToken(9), taxRate]);
  }
}

/** TVA propre à une table (null = taux du restaurant) */
async function getTableTaxRate(restaurantId, number) {
  const row = await get('SELECT tax_rate FROM restaurant_tables WHERE restaurant_id = ? AND number = ?', [restaurantId, String(number)]);
  return row && row.tax_rate !== null ? Number(row.tax_rate) : null;
}

/** Fixe (ou efface avec null) la TVA d'une table. Retourne false si la table n'existe pas. */
async function setTableTaxRate(restaurantId, number, taxRate) {
  const { changes } = await run('UPDATE restaurant_tables SET tax_rate = ? WHERE restaurant_id = ? AND number = ?', [taxRate, restaurantId, number]);
  if (changes > 0) return true;
  return Boolean(await get('SELECT number FROM restaurant_tables WHERE restaurant_id = ? AND number = ?', [restaurantId, number])); // taux inchangé
}

/** Nouveau QR code pour la table : l'ancien (imprimé ou photographié) ne fonctionne plus. */
async function regenerateTableQr(restaurantId, number) {
  const { changes } = await run(
    'UPDATE restaurant_tables SET qr_token = ? WHERE restaurant_id = ? AND number = ?',
    [newToken(9), restaurantId, number]
  );
  return changes > 0;
}

async function deleteTable(restaurantId, number) {
  await closeTableSession(restaurantId, number);
  const { changes } = await run('DELETE FROM restaurant_tables WHERE restaurant_id = ? AND number = ?', [restaurantId, number]);
  return changes > 0;
}

module.exports = {
  startSessionFromQr,
  getOpenSession,
  touchSession,
  getRecentSession,
  getOpenSessionForTable,
  closeSession,
  closeTableSession,
  listTables,
  createTables,
  getTableTaxRate,
  setTableTaxRate,
  regenerateTableQr,
  deleteTable,
};
