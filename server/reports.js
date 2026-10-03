const { get, all } = require('./database');
const { tenantCtx, addDays } = require('./tenant');

// Rapports du dashboard admin pour UN restaurant, sur la période choisie : un jour, un mois ou une année.
//  - chiffre d'affaires (factures = tables encaissées), commandes, plats les plus vendus, caissiers ;
//  - clients : une visite = une session de table ayant passé au moins une commande (aucune identité client n'est stockée).
// Les regroupements se font dans le fuseau du restaurant.

const pad = (n) => String(n).padStart(2, '0');
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** Période choisie : { mode, year, month, day, from, to } (jours locaux, bornes incluses) */
function resolveSelection(ctx, { mode, year, month, day }) {
  const [todayY, todayM] = ctx.today.split('-').map(Number);
  const m = ['day', 'month', 'year'].includes(mode) ? mode : 'month';
  const y = Number.isInteger(Number(year)) && Number(year) >= 2000 && Number(year) <= 2200 ? Number(year) : todayY;
  const mo = Number(month) >= 1 && Number(month) <= 12 ? Number(month) : todayM;
  if (m === 'day') {
    const d = isDay(day) ? day : ctx.today;
    return { mode: m, year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: d, from: d, to: d };
  }
  if (m === 'month') {
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { mode: m, year: y, month: mo, day: null, from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}` };
  }
  return { mode: m, year: y, month: null, day: null, from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Période précédente de même taille (jour d'avant, mois d'avant, année d'avant) */
function previousSelection(ctx, selection) {
  if (selection.mode === 'day') return resolveSelection(ctx, { mode: 'day', day: addDays(selection.day, -1) });
  if (selection.mode === 'month') {
    const date = new Date(Date.UTC(selection.year, selection.month - 2, 1));
    return resolveSelection(ctx, { mode: 'month', year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
  return resolveSelection(ctx, { mode: 'year', year: selection.year - 1 });
}

/** Condition SQL « cette colonne tombe dans la période » + ses paramètres */
function inPeriod(ctx, selection, column) {
  const local = ctx.local(column);
  if (selection.mode === 'day') return { sql: `DATE(${local}) = ?`, params: [selection.day] };
  if (selection.mode === 'month') return { sql: `DATE_FORMAT(${local}, '%Y-%m') = ?`, params: [`${selection.year}-${pad(selection.month)}`] };
  return { sql: `YEAR(${local}) = ?`, params: [selection.year] };
}

/** Heure (jour), jour du mois (mois) ou mois (année) d'une colonne */
function bucketOf(ctx, selection, column) {
  const local = ctx.local(column);
  if (selection.mode === 'day') return `HOUR(${local})`;
  if (selection.mode === 'month') return `DAY(${local})`;
  return `MONTH(${local})`;
}

const VISIT_FILTER = `EXISTS (SELECT 1 FROM orders o WHERE o.session_token = s.token AND o.status != 'cancelled')`;

async function summaryOf(ctx, restaurantId, selection) {
  const invoices = inPeriod(ctx, selection, 'created_at');
  const orders = inPeriod(ctx, selection, 'created_at');
  const sessions = inPeriod(ctx, selection, 's.created_at');

  const money = await get(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS invoices, COALESCE(AVG(total), 0) AS average_ticket,
            COALESCE(SUM(tax_amount), 0) AS tax, COALESCE(SUM(service_amount), 0) AS service
     FROM invoices WHERE restaurant_id = ? AND ${invoices.sql}`,
    [restaurantId, ...invoices.params]
  );
  const volume = await get(
    `SELECT COUNT(CASE WHEN status != 'cancelled' THEN 1 END) AS orders, COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled
     FROM orders WHERE restaurant_id = ? AND ${orders.sql}`,
    [restaurantId, ...orders.params]
  );
  const visits = await get(
    `SELECT COUNT(*) AS visits FROM table_sessions s WHERE s.restaurant_id = ? AND ${sessions.sql} AND ${VISIT_FILTER}`,
    [restaurantId, ...sessions.params]
  );
  return {
    ...money,
    orders: volume.orders,
    cancelled: volume.cancelled,
    visits: visits.visits,
    orders_per_visit: visits.visits ? volume.orders / visits.visits : 0,
    revenue_per_visit: visits.visits ? money.revenue / visits.visits : 0,
  };
}

async function getReport(restaurantId, query = {}) {
  const ctx = await tenantCtx(restaurantId);
  const selection = resolveSelection(ctx, query);
  const [todayY, todayM] = ctx.today.split('-').map(Number);

  const summary = await summaryOf(ctx, restaurantId, selection);
  const previous = await summaryOf(ctx, restaurantId, previousSelection(ctx, selection));

  // Chiffres de repère, toujours par rapport à aujourd'hui
  const kpis = await get(
    `SELECT
       COALESCE(SUM(CASE WHEN DATE(${ctx.local('created_at')}) = DATE(${ctx.nowLocal()}) THEN total END), 0) AS today_revenue,
       COALESCE(SUM(CASE WHEN DATE_FORMAT(${ctx.local('created_at')}, '%Y-%m') = DATE_FORMAT(${ctx.nowLocal()}, '%Y-%m') THEN total END), 0) AS month_revenue,
       COALESCE(SUM(CASE WHEN YEAR(${ctx.local('created_at')}) = ? THEN total END), 0) AS year_revenue,
       COALESCE(SUM(total), 0) AS all_time_revenue,
       COUNT(*) AS all_time_invoices
     FROM invoices WHERE restaurant_id = ?`,
    [todayY, restaurantId]
  );

  // Série de la période : une ligne par heure / jour / mois, même sans activité
  const invoiceP = inPeriod(ctx, selection, 'created_at');
  const sessionP = inPeriod(ctx, selection, 's.created_at');
  const revenueRows = await all(
    `SELECT ${bucketOf(ctx, selection, 'created_at')} AS bucket, SUM(total) AS revenue, COUNT(*) AS invoices
     FROM invoices WHERE restaurant_id = ? AND ${invoiceP.sql} GROUP BY bucket`,
    [restaurantId, ...invoiceP.params]
  );
  const orderRows = await all(
    `SELECT ${bucketOf(ctx, selection, 'created_at')} AS bucket, COUNT(*) AS orders
     FROM orders WHERE restaurant_id = ? AND status != 'cancelled' AND ${invoiceP.sql} GROUP BY bucket`,
    [restaurantId, ...invoiceP.params]
  );
  const visitRows = await all(
    `SELECT ${bucketOf(ctx, selection, 's.created_at')} AS bucket, COUNT(*) AS visits
     FROM table_sessions s WHERE s.restaurant_id = ? AND ${sessionP.sql} AND ${VISIT_FILTER} GROUP BY bucket`,
    [restaurantId, ...sessionP.params]
  );
  const bucketCount = { day: 24, month: new Date(Date.UTC(selection.year, selection.month || 1, 0)).getUTCDate(), year: 12 }[selection.mode];
  const firstBucket = selection.mode === 'day' ? 0 : 1;
  const timeline = Array.from({ length: bucketCount }, (_, i) => {
    const bucket = firstBucket + i;
    const r = revenueRows.find((row) => row.bucket === bucket);
    const o = orderRows.find((row) => row.bucket === bucket);
    const v = visitRows.find((row) => row.bucket === bucket);
    return {
      bucket,
      revenue: r ? r.revenue : 0,
      invoices: r ? r.invoices : 0,
      orders: o ? o.orders : 0,
      visits: v ? v.visits : 0,
    };
  });

  // Plats les plus vendus sur la période
  const orderP = inPeriod(ctx, selection, 'o.created_at');
  const topDishes = await all(
    `SELECT i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue, COUNT(DISTINCT o.id) AS orders
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.restaurant_id = ? AND o.status != 'cancelled' AND ${orderP.sql}
     GROUP BY i.name ORDER BY quantity DESC, revenue DESC LIMIT 15`,
    [restaurantId, ...orderP.params]
  );

  // Heures les plus chargées (commandes) et jours de la semaine les plus fréquentés (visites)
  const hourRows = await all(
    `SELECT HOUR(${ctx.local('o.created_at')}) AS hour, COUNT(*) AS orders
     FROM orders o WHERE o.restaurant_id = ? AND o.status != 'cancelled' AND ${orderP.sql} GROUP BY hour`,
    [restaurantId, ...orderP.params]
  );
  const busiestHours = hourRows.sort((a, b) => b.orders - a.orders).slice(0, 5);
  const weekdayRows = await all(
    `SELECT WEEKDAY(${ctx.local('s.created_at')}) AS weekday, COUNT(*) AS visits
     FROM table_sessions s WHERE s.restaurant_id = ? AND ${sessionP.sql} AND ${VISIT_FILTER} GROUP BY weekday`,
    [restaurantId, ...sessionP.params]
  );
  const visitsByWeekday = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, // 0 = lundi ... 6 = dimanche
    visits: (weekdayRows.find((row) => row.weekday === weekday) || {}).visits || 0,
  }));
  const visitHours = await all(
    `SELECT HOUR(${ctx.local('s.created_at')}) AS hour, COUNT(*) AS visits
     FROM table_sessions s WHERE s.restaurant_id = ? AND ${sessionP.sql} AND ${VISIT_FILTER} GROUP BY hour`,
    [restaurantId, ...sessionP.params]
  );

  // Mois les plus demandés (toutes années confondues)
  const busiestMonths = await all(
    `SELECT DATE_FORMAT(${ctx.local('created_at')}, '%Y-%m') AS label, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS amount
     FROM orders WHERE restaurant_id = ? AND status != 'cancelled' GROUP BY label ORDER BY orders DESC, label DESC LIMIT 12`,
    [restaurantId]
  );

  // Caissiers : tables encaissées, chiffre d'affaires, ticket moyen, réclamations pendant leur service (sur la période)
  const cashierRows = await all(
    `SELECT COALESCE(cashier_name, 'Not recorded') AS name, COUNT(*) AS invoices, SUM(total) AS revenue,
            AVG(total) AS average_ticket, MAX(created_at) AS last_payment
     FROM invoices WHERE restaurant_id = ? AND ${invoiceP.sql}
     GROUP BY COALESCE(cashier_name, 'Not recorded') ORDER BY revenue DESC`,
    [restaurantId, ...invoiceP.params]
  );
  const complaintRows = await all(
    `SELECT cashier_names FROM complaints WHERE restaurant_id = ? AND ${invoiceP.sql} AND cashier_names IS NOT NULL`,
    [restaurantId, ...invoiceP.params]
  );
  const registered = await all('SELECT name, status FROM cashiers WHERE restaurant_id = ? ORDER BY name', [restaurantId]);
  const names = new Set([...cashierRows.map((c) => c.name), ...registered.map((c) => c.name)]);
  const cashiers = [...names].map((name) => {
    const row = cashierRows.find((c) => c.name === name);
    const account = registered.find((c) => c.name === name);
    return {
      name,
      status: account ? account.status : null,
      invoices: row ? row.invoices : 0,
      revenue: row ? row.revenue : 0,
      average_ticket: row ? row.average_ticket : 0,
      last_payment: row ? row.last_payment : null,
      complaints: complaintRows.filter((c) => c.cashier_names.split(', ').includes(name)).length,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Par année (toutes les années) et années disponibles pour le sélecteur
  const yearly = await all(
    `SELECT YEAR(${ctx.local('created_at')}) AS year, SUM(total) AS revenue, COUNT(*) AS invoices
     FROM invoices WHERE restaurant_id = ? GROUP BY year ORDER BY year`,
    [restaurantId]
  );
  const years = [...new Set([
    todayY,
    ...(await all(`SELECT DISTINCT YEAR(${ctx.local('created_at')}) AS year FROM orders WHERE restaurant_id = ?`, [restaurantId])).map((r) => r.year),
  ])].sort((a, b) => b - a);

  return {
    timezone: ctx.tz,
    today: ctx.today,
    currentMonth: todayM,
    mode: selection.mode,
    selection,
    bucket: { day: 'hour', month: 'day', year: 'month' }[selection.mode],
    years,
    kpis,
    summary,
    previous,
    timeline,
    topDishes,
    busiestHours,
    busiestMonths,
    cashiers,
    yearly,
    clients: {
      visits: summary.visits,
      previous_visits: previous.visits,
      orders_per_visit: summary.orders_per_visit,
      revenue_per_visit: summary.revenue_per_visit,
      by_hour: visitHours.sort((a, b) => a.hour - b.hour),
      by_weekday: visitsByWeekday,
    },
  };
}

module.exports = { getReport };
