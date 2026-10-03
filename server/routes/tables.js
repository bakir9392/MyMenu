const express = require('express');
const router = express.Router();
const sessions = require('../tableSessions');
const { listSessionOrders } = require('../orders');
const { getSessionBill, listSessionMessages } = require('../invoices');
const { requireStaff, requireAdmin } = require('../auth');

// TVA d'une table : nombre de 0 à 100, ou vide / null pour reprendre le taux du restaurant
function parseTaxRate(value) {
  if (value === undefined || value === null || value === '') return { rate: null };
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: 'The VAT rate must be between 0 and 100' };
  return { rate: Math.round(rate * 100) / 100 };
}

const fail = (res, error) => {
  console.error('Table/session error:', error);
  res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
};

const BILL_GRACE_HOURS = 12; // l'addition reste consultable un moment après le paiement

// Le client arrive via le QR code de sa table : crée ou rejoint la session de la table
router.post('/sessions/start', async (req, res) => {
  try {
    const { qr } = req.body || {};
    const session = qr ? await sessions.startSessionFromQr(String(qr)) : null;
    if (!session) {
      return res.status(404).json({ success: false, error: 'Invalid QR code' });
    }
    // Nouveau client installé : la caisse et l'admin de CE restaurant le voient tout de suite
    if (session.created) req.app.get('emitToStaff')?.(session.restaurantId, 'table-opened', { tableNumber: session.tableNumber });
    res.json({ success: true, data: { sessionToken: session.token, tableNumber: session.tableNumber } });
  } catch (error) {
    fail(res, error);
  }
});

// Vérifie qu'une session est toujours ouverte (au rechargement de la page)
router.get('/sessions/:token', async (req, res) => {
  try {
    const session = await sessions.getOpenSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session ended' });
    }
    res.json({ success: true, data: { tableNumber: session.tableNumber } });
  } catch (error) {
    fail(res, error);
  }
});

// Historique des commandes de la visite (connu seulement du téléphone qui détient le token de session)
router.get('/sessions/:token/orders', async (req, res) => {
  try {
    const session = await sessions.getRecentSession(req.params.token, BILL_GRACE_HOURS);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const orders = await listSessionOrders(session.token);
    res.json({ success: true, data: orders, count: orders.length });
  } catch (error) {
    fail(res, error);
  }
});

// Messages reçus par le client pendant sa visite
router.get('/sessions/:token/messages', async (req, res) => {
  try {
    const session = await sessions.getRecentSession(req.params.token, BILL_GRACE_HOURS);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const data = await listSessionMessages(session.token);
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    fail(res, error);
  }
});

// Addition de la visite, à enregistrer ou imprimer par le client : la facture une fois la table encaissée
router.get('/sessions/:token/bill', async (req, res) => {
  try {
    const session = await sessions.getRecentSession(req.params.token, BILL_GRACE_HOURS);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const bill = await getSessionBill(session);
    if (bill.lines.length === 0) return res.status(404).json({ success: false, error: 'Nothing to bill yet' });
    res.json({ success: true, data: bill });
  } catch (error) {
    fail(res, error);
  }
});

// Tables du restaurant et leurs QR codes (dashboard admin et caisse)
router.get('/tables', requireStaff, async (req, res) => {
  try {
    const tables = await sessions.listTables(req.auth.restaurantId);
    res.json({ success: true, data: tables, count: tables.length });
  } catch (error) {
    fail(res, error);
  }
});

// Body: { count: 10 } pour créer les tables 1..10, ou { numbers: ["1", "A3"] }
router.post('/tables', requireStaff, async (req, res) => {
  try {
    const { count, numbers } = req.body || {};
    const tax = parseTaxRate((req.body || {}).tax_rate);
    if (tax.error) return res.status(422).json({ success: false, error: tax.error });
    let list = [];
    if (Array.isArray(numbers)) {
      list = numbers.map((n) => String(n).trim().slice(0, 50)).filter(Boolean).slice(0, 500);
    } else if (Number.isInteger(count) && count > 0 && count <= 500) {
      list = Array.from({ length: count }, (_, i) => String(i + 1));
    }
    if (list.length === 0) {
      return res.status(400).json({ success: false, error: 'Provide "count" (1-500) or "numbers"' });
    }
    await sessions.createTables(req.auth.restaurantId, list, tax.rate);
    const tables = await sessions.listTables(req.auth.restaurantId);
    res.status(201).json({ success: true, data: tables, count: tables.length });
  } catch (error) {
    fail(res, error);
  }
});

// Body: { tax_rate: 10 } pour une TVA propre à cette table, { tax_rate: null } pour reprendre celle du restaurant
router.patch('/tables/:number', requireAdmin, async (req, res) => {
  try {
    const tax = parseTaxRate((req.body || {}).tax_rate);
    if (tax.error) return res.status(422).json({ success: false, error: tax.error });
    const ok = await sessions.setTableTaxRate(req.auth.restaurantId, req.params.number, tax.rate);
    if (!ok) return res.status(404).json({ success: false, error: 'Table not found' });
    // Les téléphones des clients relisent les paramètres : leur addition suit le nouveau taux
    req.app.get('emitToRestaurant')?.(req.auth.restaurantId, 'settings-updated');
    res.json({ success: true, data: { number: req.params.number, tax_rate: tax.rate } });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/tables/:number/regenerate', requireStaff, async (req, res) => {
  try {
    const ok = await sessions.regenerateTableQr(req.auth.restaurantId, req.params.number);
    if (!ok) return res.status(404).json({ success: false, error: 'Table not found' });
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/tables/:number', requireStaff, async (req, res) => {
  try {
    const ok = await sessions.deleteTable(req.auth.restaurantId, req.params.number);
    if (!ok) return res.status(404).json({ success: false, error: 'Table not found' });
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
