const tableSessions = require('./tableSessions');
const { getSettings, updateSettings, CURRENCIES } = require('./settings');

// Restaurant d'une requête : celui du personnel connecté, ou celui de la session de table du client
// (jeton envoyé dans l'en-tête X-Session-Token). Sans l'un ni l'autre, la requête est refusée.

const SESSION_GRACE_HOURS = 3; // un client peut encore consulter le menu et son addition juste après avoir payé

async function tenant(req, res, next) {
  try {
    if (req.auth) {
      req.rid = req.auth.restaurantId;
      return next();
    }
    const token = req.headers['x-session-token'] || req.query.session;
    const session = await tableSessions.getRecentSession(typeof token === 'string' ? token : '', SESSION_GRACE_HOURS);
    if (!session) {
      return res.status(401).json({ success: false, error: 'session_required', message: "Scan your table's QR code to see the menu" });
    }
    req.rid = session.restaurantId;
    req.customer = session;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Le menu se règle dans une seule devise par restaurant (euro ou dollar). Les écrans d'ajout de plat la proposent :
 * si elle change, elle change pour tout le menu et toutes les factures du restaurant. Retourne true si elle a changé.
 */
async function applyCurrency(req, currency) {
  if (currency === undefined || currency === null || currency === '') return { changed: false };
  const value = String(currency).toUpperCase();
  if (!CURRENCIES.includes(value)) return { error: 'Unsupported currency (EUR, USD or DZD)' };
  if ((await getSettings(req.rid)).currency === value) return { changed: false };
  const result = await updateSettings(req.rid, { currency: value });
  if (result.errors) return { error: result.errors.currency || 'Invalid currency' };
  req.app.get('emitToRestaurant')?.(req.rid, 'settings-updated');
  return { changed: true };
}

module.exports = { tenant, applyCurrency };
