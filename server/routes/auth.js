const express = require('express');
const router = express.Router();
const { setting } = require('../config');
const {
  registerRestaurant, loginAdmin, loginCashier, changeAdminPassword, describe,
  resetPasswordWithKey, requestPasswordReset, resetPasswordWithToken,
} = require('../restaurants');
const cashierSessions = require('../cashierSessions');
const { issueToken, requireStaff, requireAdmin, throttleKey, isThrottled, recordFailure, clearFailures } = require('../auth');
const { getLicenseStatus, renewLicense, listAllKeys, insertKeys } = require('../license');

// Comptes admin : inscription d'un restaurant, connexion, session courante, changement de mot de passe,
// mot de passe oublié, statut de licence.

const signupOpen = () => String(setting('ALLOW_SIGNUP', 'true')).toLowerCase() !== 'false';

// Informations publiques de l'écran de connexion (l'inscription est-elle ouverte ?)
router.get('/options', (req, res) => {
  const whatsapp = String(setting('WHATSAPP_NUMBER', '')).replace(/\D/g, ''); // chiffres seulement : sert au lien https://wa.me/<numéro>
  res.json({ success: true, data: { signupOpen: signupOpen(), whatsapp: whatsapp || null } });
});

router.post('/register', async (req, res, next) => {
  try {
    if (!signupOpen()) return res.status(403).json({ success: false, error: 'Sign-ups are closed', message: 'Sign-ups are closed on this server' });
    const key = throttleKey(req, 'register');
    if (isThrottled(key)) return res.status(429).json({ success: false, error: 'Too many attempts, try again later' });
    const { errors, session } = await registerRestaurant(req.body || {}, issueToken);
    if (errors) {
      recordFailure(key);
      return res.status(422).json({ success: false, error: 'Validation failed', errors });
    }
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

// Un seul écran de connexion pour tout le monde : l'e-mail désigne un admin ou un caissier, et la réponse porte son rôle
// ("admin" ou "cashier") pour que l'interface ouvre le tableau de bord ou la caisse.
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(422).json({ success: false, error: 'Email and password are required' });
    const key = throttleKey(req, email);
    if (isThrottled(key)) return res.status(429).json({ success: false, error: 'Too many attempts, try again in a few minutes' });
    const session = (await loginAdmin(email, password, issueToken)) || (await loginCashier(email, password, issueToken));
    if (!session) {
      recordFailure(key);
      return res.status(401).json({ success: false, error: 'Incorrect email or password' });
    }
    clearFailures(key);
    if (session.role === 'cashier') {
      cashierSessions.start({ id: session.cashier.id, restaurantId: session.restaurant.id, name: session.cashier.name });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

// Session courante (admin ou caissier) : permet à l'interface de vérifier que son jeton est encore valable
router.get('/me', requireStaff, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: { role: req.auth.role, id: req.auth.id, name: req.auth.name, restaurant: await describe(req.auth.restaurantId) },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', requireAdmin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(422).json({ success: false, error: 'The new password must have at least 8 characters' });
    }
    if (!(await changeAdminPassword(req.auth.id, currentPassword, newPassword))) {
      return res.status(401).json({ success: false, error: 'The current password is incorrect' });
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ---- Mot de passe oublié ----

/**
 * Réinitialisation avec la clé d'activation de l'admin (la clé saisie à l'inscription, liée à son compte) : pas d'e-mail nécessaire.
 * Corps : { email, activationKey, newPassword (≥ 8) }. Une réponse unique pour « e-mail inconnu » et « mauvaise clé ».
 */
router.post('/reset-password-with-key', async (req, res, next) => {
  try {
    const { email, activationKey, newPassword } = req.body || {};
    if (!email || !activationKey || !newPassword) {
      return res.status(422).json({ success: false, error: 'Email, activation key and new password are required' });
    }
    const key = throttleKey(req, `reset-key:${email}`);
    if (isThrottled(key)) return res.status(429).json({ success: false, error: 'Too many attempts, try again later' });
    const result = await resetPasswordWithKey(email, activationKey, newPassword);
    if (result === 'weak_password') return res.status(422).json({ success: false, error: 'The new password must have at least 8 characters' });
    if (result !== 'ok') {
      recordFailure(key);
      return res.status(401).json({ success: false, error: 'Incorrect email or activation key' });
    }
    clearFailures(key);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(422).json({ success: false, error: 'Email is required' });
    const key = throttleKey(req, `forgot:${email}`);
    if (isThrottled(key)) return res.status(429).json({ success: false, error: 'Too many attempts, try again later' });
    await requestPasswordReset(String(email).trim());
    // Toujours répondre OK pour ne pas révéler si l'email existe
    res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    const result = await resetPasswordWithToken(token, newPassword);
    if (result === 'ok') return res.json({ success: true });
    if (result === 'expired') return res.status(410).json({ success: false, error: 'This reset link has expired. Please request a new one.' });
    return res.status(400).json({ success: false, error: 'Invalid or already used reset link.' });
  } catch (error) {
    next(error);
  }
});

// ---- Licence ----

/** Statut de la licence du restaurant connecté */
router.get('/license', requireAdmin, async (req, res, next) => {
  try {
    const status = await getLicenseStatus(req.auth.restaurantId);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

/** Renouvellement de la licence avec une nouvelle clé */
router.post('/license/renew', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(422).json({ success: false, error: 'Activation key is required' });
    const result = await renewLicense(key, req.auth.restaurantId, req.auth.id);
    if (result.error) return res.status(422).json({ success: false, error: 'Invalid or already used activation key' });
    const status = await getLicenseStatus(req.auth.restaurantId);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

/** Liste toutes les clés (super-admin, protégé par un secret header) */
router.get('/license/keys', async (req, res, next) => {
  try {
    const secret = setting('ADMIN_SECRET', '');
    if (!secret || req.headers['x-admin-secret'] !== secret) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const keys = await listAllKeys();
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
});

/** Insère de nouvelles clés (super-admin) */
router.post('/license/keys', async (req, res, next) => {
  try {
    const secret = setting('ADMIN_SECRET', '');
    if (!secret || req.headers['x-admin-secret'] !== secret) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { keys } = req.body || {};
    if (!Array.isArray(keys) || keys.length === 0) return res.status(422).json({ success: false, error: 'Provide an array of keys' });
    await insertKeys(keys);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
