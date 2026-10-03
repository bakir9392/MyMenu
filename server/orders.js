const crypto = require('crypto');
const { run, get, all, transaction } = require('./database');
const { tenantCtx } = require('./tenant');

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'];
const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Enregistre une commande acceptée. Les plats et leurs prix viennent du menu du restaurant, jamais du téléphone :
 * un plat inconnu, d'un autre restaurant ou indisponible refuse toute la commande.
 * Retourne { order: { id, total } } ou { error: 'empty_order' | 'invalid_item' }.
 */
async function saveOrder(restaurantId, order, session) {
  const rawItems = Array.isArray(order.items) ? order.items.slice(0, 100) : [];
  if (rawItems.length === 0) return { error: 'empty_order' };

  const ids = [...new Set(rawItems.map((item) => parseInt(item.id, 10)).filter(Number.isInteger))];
  if (ids.length === 0) return { error: 'invalid_item' };
  const dishes = await all(
    `SELECT id, name, price, is_available FROM dishes WHERE restaurant_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [restaurantId, ...ids]
  );
  const byId = new Map(dishes.map((dish) => [dish.id, dish]));

  const lines = [];
  for (const item of rawItems) {
    const dish = byId.get(parseInt(item.id, 10));
    if (!dish || !dish.is_available) return { error: 'invalid_item' };
    lines.push({
      dishId: String(dish.id),
      name: dish.name,
      price: Number(dish.price),
      quantity: clamp(parseInt(item.quantity, 10) || 1, 1, 99),
      notes: String(item.notes || '').trim().slice(0, 500) || null,
    });
  }
  const total = Math.round(lines.reduce((sum, line) => sum + line.price * line.quantity, 0) * 100) / 100;
  const id = `order_${session.tableNumber}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO orders (id, restaurant_id, table_number, session_token, status, total, note) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [id, restaurantId, session.tableNumber, session.token, total, String(order.note || '').trim().slice(0, 500) || null]
    );
    for (const line of lines) {
      await tx.run(
        `INSERT INTO order_items (order_id, dish_id, name, price, quantity, notes) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, line.dishId, line.name, line.price, line.quantity, line.notes]
      );
    }
  });
  return { order: { id, total, items: lines.map((l) => ({ id: l.dishId, name: l.name, price: l.price, quantity: l.quantity, notes: l.notes })) } };
}

async function updateOrderStatus(restaurantId, orderId, status) {
  if (!ORDER_STATUSES.includes(status)) return 0;
  const { changes } = await run(
    `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP,
            paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
     WHERE id = ? AND restaurant_id = ?`,
    [status, status, String(orderId), restaurantId]
  );
  return changes;
}

async function getOrder(restaurantId, orderId) {
  return get('SELECT table_number, session_token, status FROM orders WHERE id = ? AND restaurant_id = ?', [String(orderId), restaurantId]);
}

/** Commandes pas encore payées ni annulées d'une visite */
function activeOrdersOfSession(sessionToken) {
  return all(
    `SELECT id, table_number, status FROM orders
     WHERE session_token = ? AND status NOT IN ('paid', 'cancelled') ORDER BY created_at`,
    [sessionToken]
  );
}

async function withItems(orders) {
  if (orders.length === 0) return [];
  const items = await all(
    `SELECT order_id, dish_id, name, price, quantity, notes FROM order_items
     WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`,
    orders.map((o) => o.id)
  );
  const byOrder = {};
  for (const item of items) (byOrder[item.order_id] ||= []).push(item);
  return orders.map((o) => ({ ...o, items: byOrder[o.id] || [] }));
}

/** Commandes avec leurs lignes. scope: 'active' (en cours) | 'today' | 'all' */
async function listOrders(restaurantId, scope = 'active', limit = 200) {
  const ctx = await tenantCtx(restaurantId);
  const filters = ['o.restaurant_id = ?'];
  const params = [restaurantId];
  if (scope === 'active') {
    filters.push(`o.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`);
    params.push(...ACTIVE_STATUSES);
  } else if (scope === 'today') {
    filters.push(ctx.periodFilter('today', 'o.created_at'));
  }
  const orders = await all(
    `SELECT o.id, o.table_number, o.status, o.total, o.note, o.created_at, o.updated_at, o.paid_at
     FROM orders o WHERE ${filters.join(' AND ')} ORDER BY o.created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return withItems(orders);
}

/** Commandes d'une visite (session de table), avec leurs lignes : historique affiché au client */
async function listSessionOrders(sessionToken) {
  const orders = await all(
    `SELECT id, table_number, status, total, note, created_at, updated_at, paid_at
     FROM orders WHERE session_token = ? ORDER BY created_at ASC`,
    [sessionToken]
  );
  return withItems(orders);
}

/**
 * Statistiques du restaurant pour le dashboard admin. period: today | week | month | year.
 * Les plats les plus commandés portent toujours sur les 30 derniers jours, quelle que soit la période.
 */
async function getStats(restaurantId, period = 'today') {
  const ctx = await tenantCtx(restaurantId);
  const p = ['today', 'week', 'month', 'year'].includes(period) ? period : 'today';
  const filter = ctx.periodFilter(p, 'o.created_at');

  const summary = await get(`
    SELECT
      COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders_count,
      COUNT(CASE WHEN o.status = 'paid' THEN 1 END) AS paid_orders,
      COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) AS cancelled_orders,
      COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN o.table_number END) AS tables_served
    FROM orders o WHERE o.restaurant_id = ? AND ${filter}
  `, [restaurantId]);

  // Chiffre d'affaires et ticket moyen : depuis les factures (frais de table / service et TVA compris),
  // comme les rapports et la liste des factures
  const invoiceFilter = ctx.periodFilter(p, 'v.created_at');
  const money = await get(`
    SELECT COALESCE(SUM(v.total), 0) AS revenue, COALESCE(AVG(v.total), 0) AS average_ticket
    FROM invoices v WHERE v.restaurant_id = ? AND ${invoiceFilter}
  `, [restaurantId]);
  summary.revenue = money.revenue;
  summary.average_ticket = money.average_ticket;

  const topDishes = await all(`
    SELECT i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.restaurant_id = ? AND o.status != 'cancelled' AND ${ctx.periodFilter('last30', 'o.created_at')}
    GROUP BY i.name ORDER BY quantity DESC, revenue DESC LIMIT 10
  `, [restaurantId]);

  // Aujourd'hui : par heure ; sinon : par jour
  const bucketOf = (column) => (p === 'today'
    ? `DATE_FORMAT(${ctx.local(column)}, '%H:00')`
    : `DATE_FORMAT(${ctx.local(column)}, '%Y-%m-%d')`);
  const orderBuckets = await all(`
    SELECT ${bucketOf('o.created_at')} AS label, COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders
    FROM orders o WHERE o.restaurant_id = ? AND ${filter}
    GROUP BY label
  `, [restaurantId]);
  const revenueBuckets = await all(`
    SELECT ${bucketOf('v.created_at')} AS label, SUM(v.total) AS revenue
    FROM invoices v WHERE v.restaurant_id = ? AND ${invoiceFilter}
    GROUP BY label
  `, [restaurantId]);
  const labels = [...new Set([...orderBuckets, ...revenueBuckets].map((b) => b.label))].sort();
  const timeline = labels.map((label) => ({
    label,
    orders: (orderBuckets.find((b) => b.label === label) || {}).orders || 0,
    revenue: (revenueBuckets.find((b) => b.label === label) || {}).revenue || 0,
  }));

  const live = await get(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})) AS active_orders,
      (SELECT COUNT(*) FROM orders WHERE restaurant_id = ? AND status = 'pending') AS pending_orders,
      (SELECT COUNT(DISTINCT table_number) FROM table_sessions WHERE restaurant_id = ? AND status = 'open') AS occupied_tables,
      (SELECT COUNT(*) FROM restaurant_tables WHERE restaurant_id = ?) AS total_tables
  `, [restaurantId, ...ACTIVE_STATUSES, restaurantId, restaurantId, restaurantId]);

  return {
    period: p,
    today: ctx.today,
    range: ctx.periodRange(p), // jours couverts par les chiffres, dans le fuseau du restaurant
    topDishesRange: { days: 30, ...ctx.periodRange('last30') },
    summary,
    topDishes,
    timeline,
    live,
  };
}

module.exports = {
  ORDER_STATUSES, saveOrder, updateOrderStatus, getOrder, activeOrdersOfSession, listOrders, listSessionOrders, getStats,
};
