const { get, run, all } = require('./database');

// Gestion des clés d'activation (licences mensuelles).
// Chaque restaurant doit activer une clé lors de l'inscription pour bénéficier d'un mois d'essai gratuit.
// Après expiration, le système bloque l'accès admin jusqu'à saisie d'une nouvelle clé valide.

/**
 * Vérifie qu'une clé existe, est disponible (non utilisée) et retourne la ligne.
 * Retourne null si la clé est inconnue ou déjà utilisée.
 */
async function findAvailableKey(key) {
  if (!key || typeof key !== 'string') return null;
  const normalized = key.trim().toUpperCase().replace(/\s+/g, '-');
  const row = await get(
    'SELECT * FROM license_keys WHERE `key` = ? AND used_by_restaurant IS NULL',
    [normalized]
  );
  return row || null;
}

/**
 * Active une clé pour un restaurant (appelé après la création du compte admin) et la lie à cet admin.
 * Donne 1 mois d'accès à compter d'aujourd'hui.
 */
async function activateKey(key, restaurantId, adminId = null) {
  const normalized = key.trim().toUpperCase().replace(/\s+/g, '-');
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + 1);

  const activatedAt = now.toISOString().slice(0, 19).replace('T', ' ');
  const expiresAt = expires.toISOString().slice(0, 19).replace('T', ' ');

  await run(
    'UPDATE license_keys SET used_by_restaurant = ?, admin_id = ?, activated_at = ?, expires_at = ? WHERE `key` = ? AND used_by_restaurant IS NULL',
    [restaurantId, adminId, activatedAt, expiresAt, normalized]
  );
}

/**
 * Retourne la clé active d'un restaurant, ou null si le restaurant n'a pas de clé valide.
 * { key, activatedAt, expiresAt, expired }
 */
async function getLicenseStatus(restaurantId) {
  const row = await get(
    'SELECT `key`, activated_at, expires_at FROM license_keys WHERE used_by_restaurant = ? ORDER BY expires_at DESC LIMIT 1',
    [restaurantId]
  );
  if (!row) return null;
  const expired = row.expires_at && new Date(row.expires_at + 'Z') < new Date();
  return {
    key: row.key,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    expired: Boolean(expired),
  };
}

/**
 * Tente de renouveler la licence d'un restaurant avec une nouvelle clé (non utilisée).
 * Retourne { ok: true } ou { error: 'invalid_key' }
 */
async function renewLicense(key, restaurantId, adminId = null) {
  const row = await findAvailableKey(key);
  if (!row) return { error: 'invalid_key' };
  await activateKey(row.key, restaurantId, adminId);
  return { ok: true };
}

/**
 * La clé prouve-t-elle l'identité de cet admin ? Vrai si elle est liée à son compte (ou, pour une clé activée avant ce lien,
 * à son restaurant). Sert à réinitialiser le mot de passe sans e-mail : seul le détenteur de la clé peut le faire.
 */
async function keyBelongsToAdmin(key, adminId, restaurantId) {
  if (!key || typeof key !== 'string') return false;
  const normalized = key.trim().toUpperCase().replace(/\s+/g, '-');
  const row = await get(
    'SELECT `key` FROM license_keys WHERE `key` = ? AND (admin_id = ? OR (admin_id IS NULL AND used_by_restaurant = ?))',
    [normalized, adminId, restaurantId]
  );
  return Boolean(row);
}

/** Insère de nouvelles clés (administration interne du système) */
async function insertKeys(keys) {
  for (const key of keys) {
    const normalized = key.trim().toUpperCase().replace(/\s+/g, '-');
    await run(
      'INSERT IGNORE INTO license_keys (`key`) VALUES (?)',
      [normalized]
    );
  }
}

/** Liste toutes les clés (pour l'affichage admin) */
async function listAllKeys() {
  return all(
    `SELECT lk.\`key\`, lk.activated_at, lk.expires_at, lk.created_at,
            r.name AS restaurant_name,
            CASE WHEN lk.expires_at IS NOT NULL AND lk.expires_at < NOW() THEN 1 ELSE 0 END AS is_expired
     FROM license_keys lk
     LEFT JOIN restaurants r ON r.id = lk.used_by_restaurant
     ORDER BY lk.created_at DESC`
  );
}

module.exports = { findAvailableKey, activateKey, getLicenseStatus, renewLicense, keyBelongsToAdmin, insertKeys, listAllKeys };
