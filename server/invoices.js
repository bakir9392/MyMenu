const { run, get, all, transaction } = require('./database');
const { tenantCtx } = require('./tenant');
const { getSettings, computeBill } = require('./settings');
const { getTableTaxRate } = require('./tableSessions');

// Factures et messages aux tables

/**
 * Crée la facture d'une visite à partir de ses commandes payées (une seule fois par visite).
 * Les lignes identiques (même plat, même prix) sont regroupées. Numérotation continue par restaurant.
 */
async function createInvoiceForSession(restaurantId, sessionToken, cashierName = null) {
  const existing = await get('SELECT id FROM invoices WHERE session_token = ?', [sessionToken]);
  if (existing) return existing.id;

  const lines = await all(
    `SELECT i.name, i.price, SUM(i.quantity) AS quantity, MIN(o.table_number) AS table_number
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.restaurant_id = ? AND o.session_token = ? AND o.status = 'paid'
     GROUP BY i.name, i.price ORDER BY MIN(i.id)`,
    [restaurantId, sessionToken]
  );
  if (lines.length === 0) return null;

  // Frais de table / service et TVA selon les paramètres du restaurant, figés sur la facture
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const bill = computeBill(subtotal, await getSettings(restaurantId), await getTableTaxRate(restaurantId, lines[0].table_number));
  const year = (await tenantCtx(restaurantId)).today.slice(0, 4);

  try {
    return await transaction(async (tx) => {
      const { lastID } = await tx.run(
        `INSERT INTO invoices (restaurant_id, session_token, table_number, total, cashier_name, subtotal, service_amount, service_label, tax_amount, tax_rate, tax_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [restaurantId, sessionToken, lines[0].table_number, bill.total, cashierName ? String(cashierName).slice(0, 100) : null,
          bill.subtotal, bill.service, bill.serviceLabel, bill.tax, bill.taxRate, bill.taxMode]
      );
      await tx.run('UPDATE restaurants SET invoice_seq = LAST_INSERT_ID(invoice_seq + 1) WHERE id = ?', [restaurantId]);
      const { n } = await tx.get('SELECT LAST_INSERT_ID() AS n');
      await tx.run('UPDATE invoices SET number = ? WHERE id = ?', [`F-${year}-${String(n).padStart(5, '0')}`, lastID]);
      for (const line of lines) {
        await tx.run('INSERT INTO invoice_items (invoice_id, name, price, quantity) VALUES (?, ?, ?, ?)',
          [lastID, line.name, line.price, line.quantity]);
      }
      return lastID;
    });
  } catch (error) {
    // Deux encaissements simultanés de la même visite : la facture existe déjà
    if (error.code === 'ER_DUP_ENTRY') {
      const created = await get('SELECT id FROM invoices WHERE session_token = ?', [sessionToken]);
      if (created) return created.id;
    }
    throw error;
  }
}

const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Filtre de dates : période prédéfinie, ou intervalle personnalisé "from" / "to" (jours locaux, inclus).
 * Retourne [clause SQL, paramètres].
 */
function dateFilter(ctx, { period, from, to }, column = 'created_at') {
  if (isDate(from) || isDate(to)) {
    const clauses = [];
    const params = [];
    if (isDate(from)) { clauses.push(`DATE(${ctx.local(column)}) >= ?`); params.push(from); }
    if (isDate(to)) { clauses.push(`DATE(${ctx.local(column)}) <= ?`); params.push(to); }
    return [clauses.join(' AND '), params];
  }
  return [ctx.periodFilter(['today', 'week', 'month', 'year', 'all'].includes(period) ? period : 'today', column), []];
}

async function listInvoices(restaurantId, { period = 'today', search = '', from, to, withItems = false } = {}) {
  const ctx = await tenantCtx(restaurantId);
  const [filter, params] = dateFilter(ctx, { period, from, to });
  const term = `%${String(search).trim()}%`;
  const invoices = await all(
    `SELECT id, number, table_number, total, cashier_name, created_at,
            subtotal, service_amount, service_label, tax_amount, tax_rate, tax_mode,
            (SELECT COALESCE(SUM(quantity), 0) FROM invoice_items WHERE invoice_id = invoices.id) AS items_count
     FROM invoices
     WHERE restaurant_id = ? AND ${filter} AND (number LIKE ? OR table_number LIKE ?)
     ORDER BY id DESC LIMIT 2000`,
    [restaurantId, ...params, term, term]
  );
  if (withItems && invoices.length > 0) {
    const items = await all(
      `SELECT invoice_id, name, price, quantity FROM invoice_items
       WHERE invoice_id IN (${invoices.map(() => '?').join(',')}) ORDER BY id`,
      invoices.map((i) => i.id)
    );
    for (const invoice of invoices) invoice.items = items.filter((item) => item.invoice_id === invoice.id);
  }
  return invoices;
}

/** Récapitulatif d'une période : totaux, par jour, par caissier, plats vendus (ticket de clôture) */
async function summarizeInvoices(restaurantId, { period = 'today', from, to } = {}) {
  const ctx = await tenantCtx(restaurantId);
  const [filter, params] = dateFilter(ctx, { period, from, to });
  const [itemsFilter] = dateFilter(ctx, { period, from, to }, 'v.created_at');
  const totals = await get(
    `SELECT COUNT(*) AS invoices, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS average_ticket,
            COALESCE(SUM(tax_amount), 0) AS tax, COALESCE(SUM(service_amount), 0) AS service,
            DATE_FORMAT(MIN(${ctx.local('created_at')}), '%Y-%m-%d') AS first_day,
            DATE_FORMAT(MAX(${ctx.local('created_at')}), '%Y-%m-%d') AS last_day
     FROM invoices WHERE restaurant_id = ? AND ${filter}`,
    [restaurantId, ...params]
  );
  const byDay = await all(
    `SELECT DATE_FORMAT(${ctx.local('created_at')}, '%Y-%m-%d') AS day, COUNT(*) AS invoices, SUM(total) AS revenue
     FROM invoices WHERE restaurant_id = ? AND ${filter} GROUP BY day ORDER BY day`,
    [restaurantId, ...params]
  );
  const byCashier = await all(
    `SELECT COALESCE(cashier_name, 'Not recorded') AS name, COUNT(*) AS invoices, SUM(total) AS revenue
     FROM invoices WHERE restaurant_id = ? AND ${filter} GROUP BY name ORDER BY revenue DESC`,
    [restaurantId, ...params]
  );
  const dishes = await all(
    `SELECT i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue
     FROM invoice_items i JOIN invoices v ON v.id = i.invoice_id
     WHERE v.restaurant_id = ? AND ${itemsFilter} GROUP BY i.name ORDER BY quantity DESC`,
    [restaurantId, ...params]
  );
  return { totals, byDay, byCashier, dishes };
}

async function getInvoice(restaurantId, id) {
  const invoice = await get(
    `SELECT id, number, table_number, total, cashier_name, created_at,
            subtotal, service_amount, service_label, tax_amount, tax_rate, tax_mode
     FROM invoices WHERE id = ? AND restaurant_id = ?`,
    [id, restaurantId]
  );
  if (!invoice) return null;
  invoice.items = await all('SELECT name, price, quantity FROM invoice_items WHERE invoice_id = ? ORDER BY id', [id]);
  return invoice;
}

/**
 * Addition d'une visite pour le client (à enregistrer sur son téléphone) : la facture si la table est
 * encaissée, sinon le détail des commandes en cours avec les frais et la TVA du restaurant.
 */
async function getSessionBill(session) {
  const settings = await getSettings(session.restaurantId);
  const shop = {
    name: settings.restaurant_name,
    address: settings.restaurant_address || null,
    phone: settings.restaurant_phone || null,
    footer: settings.receipt_footer || null,
  };

  const invoice = await get(
    `SELECT id, number, total, created_at, subtotal, service_amount, service_label, tax_amount, tax_rate, tax_mode
     FROM invoices WHERE session_token = ? AND restaurant_id = ?`,
    [session.token, session.restaurantId]
  );
  if (invoice) {
    const lines = await all('SELECT name, price, quantity FROM invoice_items WHERE invoice_id = ? ORDER BY id', [invoice.id]);
    const subtotal = invoice.subtotal ?? lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    return {
      restaurant: shop,
      currency: settings.currency,
      timezone: settings.timezone,
      table: session.tableNumber,
      status: 'paid',
      invoiceNumber: invoice.number,
      date: invoice.created_at,
      lines,
      breakdown: {
        subtotal,
        service: invoice.service_amount || 0,
        serviceLabel: invoice.service_label || null,
        tax: invoice.tax_amount || 0,
        taxRate: invoice.tax_rate || 0,
        taxMode: invoice.tax_mode || null,
        total: invoice.total,
      },
      total: invoice.total,
    };
  }

  const lines = await all(
    `SELECT i.name, i.price, SUM(i.quantity) AS quantity
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.restaurant_id = ? AND o.session_token = ? AND o.status != 'cancelled'
     GROUP BY i.name, i.price ORDER BY MIN(i.id)`,
    [session.restaurantId, session.token]
  );
  const breakdown = computeBill(
    lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
    settings,
    await getTableTaxRate(session.restaurantId, session.tableNumber)
  );
  return {
    restaurant: shop,
    currency: settings.currency,
    timezone: settings.timezone,
    table: session.tableNumber,
    status: 'open',
    invoiceNumber: null,
    date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    lines,
    breakdown,
    total: breakdown.total,
  };
}

async function saveTableMessage(restaurantId, sessionToken, tableNumber, text, sender) {
  const { lastID } = await run(
    'INSERT INTO table_messages (restaurant_id, session_token, table_number, text, sender) VALUES (?, ?, ?, ?, ?)',
    [restaurantId, sessionToken, tableNumber, text, sender || null]
  );
  return get('SELECT id, text, sender, created_at FROM table_messages WHERE id = ?', [lastID]);
}

const listSessionMessages = (sessionToken) =>
  all('SELECT id, text, sender, created_at FROM table_messages WHERE session_token = ? ORDER BY id', [sessionToken]);

module.exports = {
  createInvoiceForSession, listInvoices, summarizeInvoices, getInvoice, getSessionBill, saveTableMessage, listSessionMessages,
};
