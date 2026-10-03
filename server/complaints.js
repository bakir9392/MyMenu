const { run, get, all } = require('./database');
const { tenantCtx } = require('./tenant');

// Réclamations envoyées par les clients depuis leur table

async function createComplaint(restaurantId, { sessionToken, tableNumber, text, cashierNames }) {
  const { lastID } = await run(
    'INSERT INTO complaints (restaurant_id, session_token, table_number, text, cashier_names) VALUES (?, ?, ?, ?, ?)',
    [restaurantId, sessionToken, tableNumber, text, cashierNames.length ? cashierNames.join(', ') : null]
  );
  return get('SELECT id, table_number, text, cashier_names, status, created_at FROM complaints WHERE id = ?', [lastID]);
}

async function listComplaints(restaurantId, { period = 'all', status = 'all' } = {}) {
  const ctx = await tenantCtx(restaurantId);
  const filters = ['restaurant_id = ?', ctx.periodFilter(['today', 'week', 'month'].includes(period) ? period : 'all')];
  const params = [restaurantId];
  if (status === 'new' || status === 'resolved') {
    filters.push('status = ?');
    params.push(status);
  }
  return all(
    `SELECT id, table_number, text, cashier_names, status, created_at, resolved_at
     FROM complaints WHERE ${filters.join(' AND ')} ORDER BY id DESC LIMIT 500`,
    params
  );
}

async function setComplaintStatus(restaurantId, id, status) {
  if (!['new', 'resolved'].includes(status)) return false;
  const { changes } = await run(
    `UPDATE complaints SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = ? AND restaurant_id = ?`,
    [status, status, id, restaurantId]
  );
  return changes > 0;
}

const countNewComplaints = (restaurantId) =>
  get("SELECT COUNT(*) AS count FROM complaints WHERE restaurant_id = ? AND status = 'new'", [restaurantId]).then((r) => r.count);

module.exports = { createComplaint, listComplaints, setComplaintStatus, countNewComplaints };
