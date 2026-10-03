const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { get, run, transaction, newRestaurantCode } = require('./database');
const { getSettings, forgetSettings, CURRENCIES } = require('./settings');
const { isValidTimezone, SERVER_TZ } = require('./tenant');
const { findAvailableKey, activateKey, keyBelongsToAdmin } = require('./license');
const { sendMail } = require('./mailer');
const { setting } = require('./config');

// Comptes admin et création de restaurants. Chaque admin possède un restaurant ; ses caissiers, son menu,
// ses tables, ses commandes et ses clients lui sont rattachés par `restaurant_id`.

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

async function describe(restaurantId) {
  const settings = await getSettings(restaurantId);
  return {
    id: restaurantId,
    name: settings.restaurant_name,
    currency: settings.currency,
    timezone: settings.timezone,
  };
}

/** Session retournée à l'interface après une inscription ou une connexion */
async function adminSession(admin, issueToken) {
  return {
    role: 'admin',
    token: issueToken({ role: 'admin', restaurantId: admin.restaurant_id, userId: admin.id, name: admin.name }),
    admin: { id: admin.id, name: admin.name, email: admin.email },
    restaurant: await describe(admin.restaurant_id),
  };
}

function validateRegistration(body) {
  const errors = {};
  const restaurantName = String(body.restaurantName || '').trim();
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const activationKey = String(body.activationKey || '').trim();
  if (restaurantName.length < 2 || restaurantName.length > 120) errors.restaurantName = ['Enter the restaurant name (2 to 120 characters).'];
  if (name.length < 2 || name.length > 100) errors.name = ['Enter your name (2 to 100 characters).'];
  if (!isEmail(email) || email.length > 190) errors.email = ['Enter a valid email address.'];
  if (password.length < 8 || password.length > 100) errors.password = ['The password must have at least 8 characters.'];
  if (body.currency !== undefined && !CURRENCIES.includes(body.currency)) errors.currency = ['Unsupported currency (EUR, USD or DZD).'];
  if (!activationKey) errors.activationKey = ['An activation key is required to create an account.'];
  return { errors: Object.keys(errors).length ? errors : null, restaurantName, name, email, password, activationKey };
}

/**
 * Crée un restaurant et son compte admin. Requiert une clé d'activation valide.
 */
async function registerRestaurant(body, issueToken) {
  const { errors, restaurantName, name, email, password, activationKey } = validateRegistration(body || {});
  if (errors) return { errors };

  // Vérification de la clé d'activation AVANT de créer le compte
  const keyRow = await findAvailableKey(activationKey);
  if (!keyRow) {
    return { errors: { activationKey: ['This activation key is invalid or has already been used.'] } };
  }

  // Un e-mail désigne un seul compte (admin ou caissier) : la connexion le retrouve sans autre indice
  if ((await get('SELECT id FROM admins WHERE email = ?', [email])) || (await get('SELECT id FROM cashiers WHERE email = ?', [email]))) {
    return { errors: { email: ['An account already exists with this email address.'] } };
  }

  const currency = CURRENCIES.includes(body.currency) ? body.currency : 'EUR';
  const timezone = isValidTimezone(body.timezone) ? body.timezone : SERVER_TZ;
  const passwordHash = await bcrypt.hash(password, 10);

  const adminId = await transaction(async (tx) => {
    const adopted = (await tx.get('SELECT COUNT(*) AS n FROM admins')).n === 0 ? await tx.get('SELECT id FROM restaurants WHERE id = 1') : null;
    let restaurantId;
    if (adopted) {
      restaurantId = adopted.id;
      await tx.run('UPDATE restaurants SET name = ?, timezone = ? WHERE id = ?', [restaurantName, timezone, restaurantId]);
      await tx.run(
        "INSERT INTO settings (restaurant_id, `key`, value) VALUES (?, 'restaurant_name', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [restaurantId, restaurantName]
      );
      await tx.run(
        "INSERT INTO settings (restaurant_id, `key`, value) VALUES (?, 'currency', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [restaurantId, currency]
      );
    } else {
      let code = newRestaurantCode();
      while (await tx.get('SELECT id FROM restaurants WHERE code = ?', [code])) code = newRestaurantCode();
      restaurantId = (await tx.run('INSERT INTO restaurants (code, name, timezone) VALUES (?, ?, ?)', [code, restaurantName, timezone])).lastID;
      await tx.run("INSERT INTO settings (restaurant_id, `key`, value) VALUES (?, 'restaurant_name', ?), (?, 'currency', ?)",
        [restaurantId, restaurantName, restaurantId, currency]);
    }
    return (await tx.run('INSERT INTO admins (restaurant_id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      [restaurantId, name, email, passwordHash])).lastID;
  });

  // Activer la clé d'activation (1 mois de démo)
  const admin = await get('SELECT id, restaurant_id, name, email FROM admins WHERE id = ?', [adminId]);
  await activateKey(keyRow.key, admin.restaurant_id, admin.id);

  forgetSettings(1);
  forgetSettings(admin.restaurant_id);
  return { session: await adminSession(admin, issueToken) };
}

/** Retourne la session, ou null si l'email ou le mot de passe est faux */
async function loginAdmin(email, password, issueToken) {
  const admin = await get('SELECT id, restaurant_id, name, email, password_hash FROM admins WHERE email = ?', [normalizeEmail(email)]);
  const ok = admin && (await bcrypt.compare(String(password || ''), admin.password_hash));
  return ok ? adminSession(admin, issueToken) : null;
}

/** Connexion d'un caissier avec son e-mail (retourne la session, ou null si e-mail / mot de passe faux ou compte désactivé) */
async function loginCashier(email, password, issueToken) {
  const cashier = await get(
    "SELECT id, restaurant_id, name, email, password_hash FROM cashiers WHERE email = ? AND status = 'active'",
    [normalizeEmail(email)]
  );
  if (!cashier || !(await bcrypt.compare(String(password || ''), cashier.password_hash))) return null;
  return {
    role: 'cashier',
    token: issueToken({ role: 'cashier', restaurantId: cashier.restaurant_id, userId: cashier.id, name: cashier.name }),
    cashier: { id: cashier.id, name: cashier.name, email: cashier.email },
    restaurant: await describe(cashier.restaurant_id),
  };
}

/** Retourne false si l'ancien mot de passe est faux */
async function changeAdminPassword(adminId, currentPassword, newPassword) {
  const admin = await get('SELECT password_hash FROM admins WHERE id = ?', [adminId]);
  if (!admin || !(await bcrypt.compare(String(currentPassword || ''), admin.password_hash))) return false;
  await run('UPDATE admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [await bcrypt.hash(String(newPassword), 10), adminId]);
  return true;
}

// ---- Mot de passe oublié ----

/**
 * Réinitialise le mot de passe d'un admin avec sa clé d'activation (la clé liée à son compte à l'inscription).
 * Retourne 'ok' ou 'invalid' (e-mail inconnu ET mauvaise clé donnent la même réponse : rien n'est révélé).
 */
async function resetPasswordWithKey(email, activationKey, newPassword) {
  if (!newPassword || String(newPassword).length < 8 || String(newPassword).length > 100) return 'weak_password';
  const admin = await get('SELECT id, restaurant_id FROM admins WHERE email = ?', [normalizeEmail(email)]);
  if (!admin || !(await keyBelongsToAdmin(activationKey, admin.id, admin.restaurant_id))) return 'invalid';
  await run('UPDATE admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [await bcrypt.hash(String(newPassword), 10), admin.id]);
  await run('DELETE FROM password_reset_tokens WHERE admin_id = ?', [admin.id]); // les anciens liens e-mail ne servent plus
  return 'ok';
}

// ---- Mot de passe oublié par e-mail (lien à usage unique) ----

const RESET_TOKEN_TTL_MINUTES = 30;

/** Crée un jeton de réinitialisation et envoie le lien par email. Retourne true/false. */
async function requestPasswordReset(email) {
  const admin = await get('SELECT id, name FROM admins WHERE email = ?', [normalizeEmail(email)]);
  if (!admin) return true; // Ne pas révéler si l'email existe

  // Invalider les anciens jetons
  await run('DELETE FROM password_reset_tokens WHERE admin_id = ?', [admin.id]);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  const expiresAt = expires.toISOString().slice(0, 19).replace('T', ' ');
  await run(
    'INSERT INTO password_reset_tokens (token, admin_id, expires_at) VALUES (?, ?, ?)',
    [token, admin.id, expiresAt]
  );

  // Construire l'URL de réinitialisation
  const publicUrl = setting('PUBLIC_URL', '').trim().replace(/\/+$/, '') || 'http://localhost:8080';
  const resetUrl = `${publicUrl}/login#reset-password?token=${token}`;

  await sendMail({
    to: email,
    subject: 'Saveur – Password Reset',
    text: `Hello ${admin.name},\n\nYou requested a password reset. Click the link below to set a new password (valid for ${RESET_TOKEN_TTL_MINUTES} minutes):\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.\n\nSaveur`,
    html: `<p>Hello <strong>${admin.name}</strong>,</p>
<p>You requested a password reset. Click the button below to set a new password (valid for ${RESET_TOKEN_TTL_MINUTES} minutes):</p>
<p><a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset my password</a></p>
<p>If you did not request this, please ignore this email.</p>
<p>Saveur</p>`,
  });

  return true;
}

/**
 * Réinitialise le mot de passe avec le jeton. Retourne 'ok' | 'invalid' | 'expired'.
 */
async function resetPasswordWithToken(token, newPassword) {
  if (!token || typeof token !== 'string') return 'invalid';
  const row = await get(
    'SELECT admin_id, expires_at, used FROM password_reset_tokens WHERE token = ?',
    [token]
  );
  if (!row || row.used) return 'invalid';
  if (new Date(row.expires_at + 'Z') < new Date()) return 'expired';
  if (!newPassword || String(newPassword).length < 8) return 'invalid';

  await run(
    'UPDATE admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [await bcrypt.hash(String(newPassword), 10), row.admin_id]
  );
  await run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);
  return 'ok';
}

module.exports = {
  describe, registerRestaurant, loginAdmin, loginCashier, changeAdminPassword, adminSession,
  resetPasswordWithKey, requestPasswordReset, resetPasswordWithToken,
};
