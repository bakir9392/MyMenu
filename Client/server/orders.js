const { db } = require('./database');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ changes: this.changes });
  });
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'];
const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

/** Enregistre une commande acceptée (le total est recalculé à partir des lignes). */
async function saveOrder(order, sessionToken) {
  const items = Array.isArray(order.items) ? order.items : [];
  const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);

  await run(
    `INSERT OR IGNORE INTO orders (id, table_number, session_token, status, total) VALUES (?, ?, ?, 'pending', ?)`,
    [String(order.id), String(order.tableNumber), sessionToken || null, total]
  );
  for (const item of items) {
    await run(
      `INSERT INTO order_items (order_id, dish_id, name, price, quantity, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [String(order.id), item.id != null ? String(item.id) : null, String(item.name || ''), Number(item.price) || 0,
        Math.max(1, parseInt(item.quantity, 10) || 1), item.notes || null]
    );
  }
  return total;
}

async function updateOrderStatus(orderId, status) {
  if (!ORDER_STATUSES.includes(status)) return 0;
  const { changes } = await run(
    `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP,
            paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
     WHERE id = ?`,
    [status, status, String(orderId)]
  );
  return changes;
}

async function getOrder(orderId) {
  return get('SELECT table_number FROM orders WHERE id = ?', [String(orderId)]);
}

/** Commandes avec leurs lignes. scope: 'active' (en cours) | 'today' | 'all' */
async function listOrders(scope = 'active', limit = 200) {
  let where = '';
  if (scope === 'active') where = `WHERE o.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`;
  else if (scope === 'today') where = `WHERE date(o.created_at, 'localtime') = date('now', 'localtime')`;
  const params = scope === 'active' ? [...ACTIVE_STATUSES] : [];

  const orders = await all(
    `SELECT o.id, o.table_number, o.status, o.total, o.created_at, o.updated_at, o.paid_at
     FROM orders o ${where} ORDER BY o.created_at DESC LIMIT ?`,
    [...params, limit]
  );
  if (orders.length === 0) return [];

  const items = await all(
    `SELECT order_id, dish_id, name, price, quantity, notes FROM order_items
     WHERE order_id IN (${orders.map(() => '?').join(',')})`,
    orders.map((o) => o.id)
  );
  const byOrder = {};
  for (const item of items) (byOrder[item.order_id] ||= []).push(item);
  return orders.map((o) => ({ ...o, items: byOrder[o.id] || [] }));
}

const PERIODS = {
  today: `date(o.created_at, 'localtime') = date('now', 'localtime')`,
  week: `datetime(o.created_at, 'localtime') >= datetime('now', 'localtime', '-6 days', 'start of day')`,
  month: `datetime(o.created_at, 'localtime') >= datetime('now', 'localtime', 'start of month')`,
  year: `datetime(o.created_at, 'localtime') >= datetime('now', 'localtime', 'start of year')`,
};

/** Statistiques du restaurant pour le dashboard admin. period: today | week | month | year */
async function getStats(period = 'today') {
  const filter = PERIODS[period] || PERIODS.today;

  const summary = await get(`
    SELECT
      COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders_count,
      COUNT(CASE WHEN o.status = 'paid' THEN 1 END) AS paid_orders,
      COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) AS cancelled_orders,
      COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total END), 0) AS revenue,
      COALESCE(AVG(CASE WHEN o.status = 'paid' THEN o.total END), 0) AS average_ticket,
      COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN o.table_number END) AS tables_served
    FROM orders o WHERE ${filter}
  `);

  const topDishes = await all(`
    SELECT i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status != 'cancelled' AND ${filter}
    GROUP BY i.name ORDER BY quantity DESC LIMIT 10
  `);

  // Aujourd'hui : par heure ; sinon : par jour
  const bucket = period === 'today'
    ? `strftime('%H:00', o.created_at, 'localtime')`
    : `date(o.created_at, 'localtime')`;
  const timeline = await all(`
    SELECT ${bucket} AS label,
           COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders,
           COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total END), 0) AS revenue
    FROM orders o WHERE ${filter}
    GROUP BY label ORDER BY label
  `);

  const live = await get(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})) AS active_orders,
      (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
      (SELECT COUNT(DISTINCT table_number) FROM table_sessions WHERE status = 'open') AS occupied_tables,
      (SELECT COUNT(*) FROM restaurant_tables) AS total_tables
  `, ACTIVE_STATUSES);

  return { period, summary, topDishes, timeline, live };
}

module.exports = { ORDER_STATUSES, saveOrder, updateOrderStatus, getOrder, listOrders, getStats };
