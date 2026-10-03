const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { run, get, all } = require('../database');
const { tenantCtx } = require('../tenant');
const { forgetAccount, requireAdmin, requireCashier, encryptSecret, decryptSecret } = require('../auth');
const cashierSessions = require('../cashierSessions');

// Caissiers : comptes gérés par l'admin de CHAQUE restaurant. Un caissier se connecte avec son e-mail et son mot de passe
// (même écran que l'admin, voir /api/auth/login) ; son e-mail est unique sur toute la plateforme.
// Le mot de passe est haché (bcrypt) pour la connexion ; une copie chiffrée (clé du serveur) permet à l'admin de le relire.

const MASKED_PASSWORD = '••••••';

const serialize = (row) => ({
  id: row.id,
  name: row.name,
  password: MASKED_PASSWORD,
  /** true si l'admin peut relire le mot de passe (comptes créés ou modifiés depuis cette version) */
  passwordViewable: Boolean(row.password_enc),
  phone: row.phone,
  email: row.email,
  status: row.status,
  createdAt: String(row.created_at).slice(0, 10),
});

const validationError = (res, errors) => res.status(422).json({ message: 'Validation failed', errors });
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function validate(body, partial) {
  const errors = {};
  const { name, password, phone, email, status } = body || {};
  if (!partial || name !== undefined) {
    if (!name || !String(name).trim() || String(name).length > 100) errors.name = ['The name field is required (100 characters max).'];
  }
  if (!partial || email !== undefined) {
    const value = normalizeEmail(email);
    if (!value || !isEmail(value) || value.length > 190) errors.email = ['A valid email address is required: the cashier signs in with it.'];
  }
  if (!partial || password !== undefined) {
    if (!password || String(password).length < 6) errors.password = ['The password must be at least 6 characters.'];
  }
  if (phone && String(phone).length > 20) errors.phone = ['The phone may not be greater than 20 characters.'];
  if (status !== undefined && !['active', 'inactive'].includes(status)) errors.status = ['The selected status is invalid.'];
  return Object.keys(errors).length ? errors : null;
}

const findCashier = (restaurantId, id) => get('SELECT * FROM cashiers WHERE id = ? AND restaurant_id = ?', [id, restaurantId]);

/** Un e-mail désigne un seul compte de toute la plateforme (admin ou caissier) : la connexion le retrouve sans autre indice */
async function emailTaken(email, exceptCashierId = null) {
  if (await get('SELECT id FROM admins WHERE email = ?', [email])) return true;
  return Boolean(await get('SELECT id FROM cashiers WHERE email = ? AND id != ?', [email, exceptCashierId ?? 0]));
}

// ---- Présence (application caisse) : jeton caissier, corps vide ----

router.post('/heartbeat', requireCashier, (req, res) => {
  cashierSessions.heartbeat(req.auth);
  res.json({ ok: true });
});

router.post('/logout', requireCashier, (req, res) => {
  cashierSessions.end(req.auth.id);
  res.json({ message: 'Logout successful' });
});

// ---- Gestion des caissiers (admin du restaurant) ----

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    res.json((await all('SELECT * FROM cashiers WHERE restaurant_id = ? ORDER BY id', [req.auth.restaurantId])).map(serialize));
  } catch (error) {
    next(error);
  }
});

router.get('/active-session', requireAdmin, (req, res) => {
  res.json(cashierSessions.live(req.auth.restaurantId).map(({ restaurantId, ...session }) => session));
});

/**
 * Statistiques réelles de chaque caissier du restaurant : ventes du jour / du mois / totales, tables encaissées,
 * dernier encaissement, réclamations reçues pendant leur service, et présence en ligne.
 */
router.get('/statistics', requireAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const ctx = await tenantCtx(restaurantId);
    const rows = await all(
      `SELECT c.id, c.name, c.status, c.created_at,
              COUNT(i.id) AS transactions,
              COALESCE(SUM(i.total), 0) AS total_sales,
              COALESCE(SUM(CASE WHEN DATE(${ctx.local('i.created_at')}) = DATE(${ctx.nowLocal()}) THEN i.total END), 0) AS today_sales,
              COALESCE(SUM(CASE WHEN DATE_FORMAT(${ctx.local('i.created_at')}, '%Y-%m') = DATE_FORMAT(${ctx.nowLocal()}, '%Y-%m') THEN i.total END), 0) AS month_sales,
              COUNT(CASE WHEN DATE(${ctx.local('i.created_at')}) = DATE(${ctx.nowLocal()}) THEN 1 END) AS today_transactions,
              MAX(i.created_at) AS last_payment
       FROM cashiers c
       LEFT JOIN invoices i ON i.restaurant_id = c.restaurant_id AND i.cashier_name = c.name
       WHERE c.restaurant_id = ?
       GROUP BY c.id, c.name, c.status, c.created_at
       ORDER BY total_sales DESC, c.name`,
      [restaurantId]
    );
    const complaints = await all(
      'SELECT cashier_names FROM complaints WHERE restaurant_id = ? AND cashier_names IS NOT NULL',
      [restaurantId]
    );
    const online = new Set(cashierSessions.live(restaurantId).map((s) => s.id));
    res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        account_status: row.status, // active | inactive (compte désactivé)
        online: row.status === 'active' && online.has(row.id),
        today_sales: row.today_sales,
        month_sales: row.month_sales,
        total_sales: row.total_sales,
        transactions: row.transactions,
        today_transactions: row.today_transactions,
        average_ticket: row.transactions ? row.total_sales / row.transactions : 0,
        last_payment: row.last_payment,
        complaints: complaints.filter((c) => c.cashier_names.split(', ').includes(row.name)).length,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const errors = validate(req.body, false);
    if (errors) return validationError(res, errors);
    const restaurantId = req.auth.restaurantId;
    const { name, password, phone } = req.body;
    const email = normalizeEmail(req.body.email);
    if (await get('SELECT id FROM cashiers WHERE restaurant_id = ? AND name = ?', [restaurantId, String(name).trim()])) {
      return validationError(res, { name: ['This name is already used by another cashier.'] });
    }
    if (await emailTaken(email)) return validationError(res, { email: ['This email address is already used by another account.'] });
    const { lastID } = await run(
      `INSERT INTO cashiers (restaurant_id, name, password_hash, password_enc, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [restaurantId, String(name).trim(), await bcrypt.hash(String(password), 10), encryptSecret(String(password)), phone || null, email]
    );
    res.status(201).json(serialize(await findCashier(restaurantId, lastID)));
  } catch (error) {
    next(error);
  }
});

/** Mot de passe d'un caissier, lisible par l'admin de son restaurant (null pour un ancien compte : en définir un nouveau) */
router.get('/:id/password', requireAdmin, async (req, res, next) => {
  try {
    const cashier = await findCashier(req.auth.restaurantId, req.params.id);
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    res.json({ success: true, data: { password: cashier.password_enc ? decryptSecret(cashier.password_enc) : null } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const cashier = await findCashier(req.auth.restaurantId, req.params.id);
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    res.json(serialize(cashier));
  } catch (error) {
    next(error);
  }
});

const update = async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const cashier = await findCashier(restaurantId, req.params.id);
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    const errors = validate(req.body, true);
    if (errors) return validationError(res, errors);

    const { name, password, phone, status } = req.body;
    const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    if (name !== undefined && String(name).trim() !== cashier.name
      && await get('SELECT id FROM cashiers WHERE restaurant_id = ? AND name = ? AND id != ?', [restaurantId, String(name).trim(), cashier.id])) {
      return validationError(res, { name: ['This name is already used by another cashier.'] });
    }
    if (email !== undefined && email !== cashier.email && await emailTaken(email, cashier.id)) {
      return validationError(res, { email: ['This email address is already used by another account.'] });
    }
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(String(name).trim()); }
    if (password !== undefined) {
      fields.push('password_hash = ?', 'password_enc = ?');
      values.push(await bcrypt.hash(String(password), 10), encryptSecret(String(password)));
    }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone || null); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (fields.length) {
      await run(`UPDATE cashiers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND restaurant_id = ?`,
        [...values, cashier.id, restaurantId]);
    }
    // Les factures déjà encaissées gardent le lien avec le caissier renommé
    if (name !== undefined && String(name).trim() !== cashier.name) {
      await run('UPDATE invoices SET cashier_name = ? WHERE restaurant_id = ? AND cashier_name = ?',
        [String(name).trim(), restaurantId, cashier.name]);
    }
    if (status !== undefined || password !== undefined || name !== undefined) forgetAccount('cashier', cashier.id);
    if (status === 'inactive') cashierSessions.end(cashier.id);
    res.json(serialize(await findCashier(restaurantId, cashier.id)));
  } catch (error) {
    next(error);
  }
};
router.put('/:id', requireAdmin, update);
router.patch('/:id', requireAdmin, update);

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { changes } = await run('DELETE FROM cashiers WHERE id = ? AND restaurant_id = ?', [req.params.id, req.auth.restaurantId]);
    if (!changes) return res.status(404).json({ message: 'Cashier not found' });
    cashierSessions.end(parseInt(req.params.id, 10));
    forgetAccount('cashier', parseInt(req.params.id, 10));
    res.json({ message: 'Cashier deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.onDutyCashierNames = cashierSessions.onDutyNames;
