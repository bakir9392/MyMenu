const express = require('express');
const router = express.Router();
const orders = require('../orders');

const fail = (res, error) => {
  console.error('Orders/stats error:', error);
  res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
};

// GET /api/orders?scope=active|today|all
router.get('/orders', async (req, res) => {
  try {
    const scope = ['active', 'today', 'all'].includes(req.query.scope) ? req.query.scope : 'active';
    const data = await orders.listOrders(scope);
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    fail(res, error);
  }
});

// GET /api/stats?period=today|week|month|year
router.get('/stats', async (req, res) => {
  try {
    res.json({ success: true, data: await orders.getStats(req.query.period) });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
