const express = require('express');
const router = express.Router();
const sessions = require('../tableSessions');

const fail = (res, error) => {
  console.error('Table/session error:', error);
  res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
};

// Le client arrive via le QR code de sa table : crée ou rejoint la session de la table
router.post('/sessions/start', async (req, res) => {
  try {
    const { qr } = req.body || {};
    const session = qr ? await sessions.startSessionFromQr(String(qr)) : null;
    if (!session) {
      return res.status(404).json({ success: false, error: 'QR code invalide' });
    }
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
      return res.status(404).json({ success: false, error: 'Session terminée' });
    }
    res.json({ success: true, data: { tableNumber: session.tableNumber } });
  } catch (error) {
    fail(res, error);
  }
});

// Tables du restaurant et leurs QR codes (dashboard admin)
router.get('/tables', async (req, res) => {
  try {
    const tables = await sessions.listTables();
    res.json({ success: true, data: tables, count: tables.length });
  } catch (error) {
    fail(res, error);
  }
});

// Body: { count: 10 } pour créer les tables 1..10, ou { numbers: ["1", "A3"] }
router.post('/tables', async (req, res) => {
  try {
    const { count, numbers } = req.body || {};
    let list = [];
    if (Array.isArray(numbers)) {
      list = numbers.map((n) => String(n).trim()).filter(Boolean);
    } else if (Number.isInteger(count) && count > 0 && count <= 500) {
      list = Array.from({ length: count }, (_, i) => String(i + 1));
    }
    if (list.length === 0) {
      return res.status(400).json({ success: false, error: 'Fournir "count" (1-500) ou "numbers"' });
    }
    await sessions.createTables(list);
    const tables = await sessions.listTables();
    res.status(201).json({ success: true, data: tables, count: tables.length });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/tables/:number/regenerate', async (req, res) => {
  try {
    const ok = await sessions.regenerateTableQr(req.params.number);
    if (!ok) return res.status(404).json({ success: false, error: 'Table introuvable' });
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/tables/:number', async (req, res) => {
  try {
    const ok = await sessions.deleteTable(req.params.number);
    if (!ok) return res.status(404).json({ success: false, error: 'Table introuvable' });
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
