const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('http');
const { Server } = require('socket.io');

const { setting } = require('./config');
const { initializeDatabase } = require('./database');
const { migratePlainPasswords } = require('./cashierPasswords');
const { IMAGES_ROOT } = require('./imageStore');
const tableSessions = require('./tableSessions');
const orders = require('./orders');
const invoices = require('./invoices');
const complaints = require('./complaints');
const reports = require('./reports');
const settings = require('./settings');
const geofence = require('./geofence');
const { authenticate, requireStaff, requireAdmin, resolveAuth } = require('./auth');
const { tenant } = require('./access');
const authRoutes = require('./routes/auth');
const menuItemsRoutes = require('./routes/menuItems');
const tablesRoutes = require('./routes/tables');
const ordersRoutes = require('./routes/orders');
const cashiersRoutes = require('./routes/cashiers');
const { router: dishesRoutes } = require('./routes/dishes');

// Serveur unique pour PLUSIEURS restaurants : API (menu, notes, caissiers, tables/QR, commandes, statistiques),
// temps réel (Socket.IO) et, en production, les trois interfaces web (client, caisse, admin).
// Chaque restaurant a son compte admin, ses caissiers, son menu, ses tables et ses factures ; rien n'est partagé.

const PORT = setting('PORT', 3001);
const NODE_ENV = setting('NODE_ENV', 'development');
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});
app.set('io', io); // accessible aux routes (événements temps réel)

// Derrière un proxy (nginx, hébergeur...) : TRUST_PROXY=true pour lire la vraie adresse du visiteur
const trustProxy = setting('TRUST_PROXY', '');
if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? 1 : Number(trustProxy) || trustProxy);

// ---- Salles temps réel, une par restaurant ----
//   r<id>               tout le monde dans ce restaurant (personnel et clients)
//   r<id>:staff         caisses et admin de ce restaurant
//   r<id>:table-<n>     téléphones des clients de la table n de ce restaurant
const room = (restaurantId) => `r${restaurantId}`;
const staffRoom = (restaurantId) => `r${restaurantId}:staff`;
const tableRoom = (restaurantId, tableNumber) => `r${restaurantId}:table-${tableNumber}`;

const emitToRestaurant = (restaurantId, event, payload) => io.to(room(restaurantId)).emit(event, payload);
const emitToStaff = (restaurantId, event, payload) => io.to(staffRoom(restaurantId)).emit(event, payload);
app.set('emitToRestaurant', emitToRestaurant);
app.set('emitToStaff', emitToStaff);

// CSP désactivée : la fenêtre d'impression des QR codes utilise un script en ligne
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true }));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
// Seul l'écran du menu du personnel envoie des photos en base64 : les autres routes gardent une petite limite
app.use('/api/menu-items', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Images des plats (fichiers statiques, mises en cache par le navigateur)
app.use('/images', express.static(IMAGES_ROOT, { maxAge: '7d' }));

// Toutes les routes /api savent qui appelle (req.auth) ; chaque route décide ensuite ce qu'elle exige
app.use('/api', authenticate);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString(), environment: NODE_ENV });
});

// Adresses de cette machine sur le réseau local, pour les QR codes : un téléphone ne peut pas ouvrir "localhost".
// Les cartes virtuelles (WSL, Hyper-V, VirtualBox, VMware, Docker) sont ignorées ; la carte Wi-Fi passe en premier.
function lanAddresses() {
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|vbox|br-|veth/i;
  const wifi = /wi-?fi|wlan|wireless|sans fil/i;
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([name, list]) => (list || []).map((a) => ({ ...a, wifi: wifi.test(name) })))
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .sort((a, b) => Number(b.wifi) - Number(a.wifi) || rank(a.address) - rank(b.address))
    .map((a) => a.address);
}

app.use('/api/auth', authRoutes);

// Paramètres du restaurant (nom, coordonnées, devise, TVA, frais de table). Le client les lit avec sa session de table.
app.get('/api/settings', tenant, async (req, res, next) => {
  try {
    const data = await settings.getSettings(req.rid);
    data.order_max_distance_m = geofence.MAX_DISTANCE_M;
    if (req.auth) return res.json({ success: true, data });
    // Client : il sait seulement si sa position sera demandee ; le serveur reste seul juge de la distance
    data.location_required = geofence.restaurantPoint(data) !== null;
    delete data.location_lat;
    delete data.location_lng;
    // Client : la TVA de sa table remplace celle du restaurant, ses additions se calculent donc avec les mêmes paramètres
    const tableRate = await tableSessions.getTableTaxRate(req.rid, req.customer.tableNumber);
    if (tableRate !== null) Object.assign(data, { tax_enabled: tableRate > 0, tax_rate: tableRate });
    res.json({ success: true, data: { ...data, table_tax_rate: tableRate } });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', requireAdmin, async (req, res, next) => {
  try {
    const result = await settings.updateSettings(req.auth.restaurantId, req.body);
    if (result.errors) return res.status(422).json({ success: false, error: 'Validation failed', errors: result.errors });
    emitToRestaurant(req.auth.restaurantId, 'settings-updated');
    res.json({ success: true, data: result.settings });
  } catch (error) {
    next(error);
  }
});

app.get('/api/server-info', requireStaff, async (req, res, next) => {
  try {
    const publicUrl = setting('PUBLIC_URL', '').trim().replace(/\/+$/, '');
    const shop = await settings.getSettings(req.auth.restaurantId);
    res.json({
      success: true,
      data: {
        publicUrl: publicUrl || null,
        lanAddresses: lanAddresses(),
        restaurantName: shop.restaurant_name,
        restaurantAddress: shop.restaurant_address || null,
        restaurantPhone: shop.restaurant_phone || null,
        receiptFooter: shop.receipt_footer || null,
        currency: shop.currency,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/menu-items', menuItemsRoutes);
app.use('/api/cashiers', cashiersRoutes);
app.use('/api', dishesRoutes);
app.use('/api', tablesRoutes);

app.get('/api/invoices', requireStaff, async (req, res, next) => {
  try {
    // ?period=today|week|month|year|all ou ?from=YYYY-MM-DD&to=YYYY-MM-DD ; &items=1 pour inclure les lignes (impression en lot)
    const data = await invoices.listInvoices(req.auth.restaurantId, {
      period: req.query.period,
      search: req.query.q || '',
      from: req.query.from,
      to: req.query.to,
      withItems: req.query.items === '1',
    });
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    next(error);
  }
});

// Récapitulatif d'une période (ticket de clôture) : mêmes filtres que la liste
app.get('/api/invoices/summary', requireStaff, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await invoices.summarizeInvoices(req.auth.restaurantId, { period: req.query.period, from: req.query.from, to: req.query.to }),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/invoices/:id', requireStaff, async (req, res, next) => {
  try {
    const invoice = await invoices.getInvoice(req.auth.restaurantId, req.params.id);
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
});

// Rapports (admin) : GET /api/reports?mode=day&day=2026-10-03 | mode=month&year=2026&month=10 | mode=year&year=2026
app.get('/api/reports', requireAdmin, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await reports.getReport(req.auth.restaurantId, {
        mode: req.query.mode, year: req.query.year, month: req.query.month, day: req.query.day,
      }),
    });
  } catch (error) {
    next(error);
  }
});

// Réclamation envoyée par un client depuis sa table (la table vient de sa session, pas de ce qu'il envoie)
app.post('/api/complaints', async (req, res, next) => {
  try {
    const { sessionToken, text } = req.body || {};
    const message = String(text || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ success: false, error: 'Complaint is empty' });
    // Visite en cours ou encaissée depuis moins de 3 h (réclamation juste après avoir payé)
    const session = await tableSessions.getRecentSession(sessionToken, 3);
    if (!session) return res.status(403).json({ success: false, error: 'session_closed' });
    const complaint = await complaints.createComplaint(session.restaurantId, {
      sessionToken: session.token,
      tableNumber: session.tableNumber,
      text: message,
      cashierNames: cashiersRoutes.onDutyCashierNames(session.restaurantId),
    });
    emitToStaff(session.restaurantId, 'complaint-created', complaint);
    res.status(201).json({ success: true, data: { id: complaint.id } });
  } catch (error) {
    next(error);
  }
});

// GET /api/complaints?period=today|week|month|all&status=new|resolved|all
app.get('/api/complaints', requireStaff, async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const data = await complaints.listComplaints(restaurantId, { period: req.query.period, status: req.query.status });
    res.json({ success: true, data, count: data.length, newCount: await complaints.countNewComplaints(restaurantId) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/complaints/:id', requireStaff, async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const ok = await complaints.setComplaintStatus(restaurantId, req.params.id, req.body && req.body.status);
    if (!ok) return res.status(404).json({ success: false, error: 'Complaint not found' });
    emitToStaff(restaurantId, 'complaint-updated', { id: Number(req.params.id) });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.use('/api', ordersRoutes);

// Liberer une table : le client est parti sans payer (ou n'a rien commande). La visite se termine, le client devra
// rescanner le QR code. S'il reste des commandes non payees, elles sont annulees : l'appelant doit alors confirmer (force: true).
app.post('/api/tables/:number/release', requireStaff, async (req, res, next) => {
  try {
    const { restaurantId } = req.auth;
    const tableNumber = String(req.params.number);
    const session = await tableSessions.getOpenSessionForTable(restaurantId, tableNumber);
    if (!session) return res.json({ success: true, data: { released: false, cancelledOrders: 0 } });
    const unpaid = await orders.activeOrdersOfSession(session.token);
    if (unpaid.length > 0 && !(req.body && req.body.force === true)) {
      return res.status(409).json({ success: false, error: 'The table has unpaid orders', code: 'UNPAID_ORDERS', data: { activeOrders: unpaid.length } });
    }
    console.log(`🔓 Table ${tableNumber} released by ${req.auth.name || 'staff'} (restaurant ${restaurantId}, ${unpaid.length} unpaid order(s) cancelled)`);
    for (const order of unpaid) await setOrderStatus(restaurantId, order.id, 'cancelled');
    await finalizeVisitIfPaid(restaurantId, session.token, session.tableNumber, req.auth.name || null);
    emitToStaff(restaurantId, 'table-released', { tableNumber });
    res.json({ success: true, data: { released: true, cancelledOrders: unpaid.length } });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found', message: `The requested endpoint ${req.originalUrl} does not exist` });
});

// Interfaces web compilées (npm run build) : / = menu client, /caisse = caisse, /admin = dashboard
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  const page = (file) => (req, res) => res.sendFile(path.join(WEB_DIST, file));
  app.get(['/caisse', '/caisse/*'], page('caisse/index.html'));
  app.get(['/admin', '/admin/*', '/login', '/login/*'], page('admin/index.html'));
  app.get('*', page('index.html'));
}

app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({
    success: false,
    error: status === 413 ? 'File too large' : status === 500 ? 'Internal server error' : 'Request error',
    message: NODE_ENV === 'development' || status < 500 ? error.message : 'Something went wrong on the server',
    ...(NODE_ENV === 'development' && { stack: error.stack }),
  });
});

// ---- Temps réel ----
// Le personnel se connecte avec son jeton (auth.token) et ne reçoit que les événements de son restaurant.
// Un client n'a pas de jeton : il rejoint la salle de sa table avec le jeton de sa session, et ne reçoit que celle-là.

/** Diffuse un changement de statut au personnel et aux clients de la table concernée (même restaurant) */
function broadcastStatus(restaurantId, update) {
  emitToStaff(restaurantId, 'order-status-changed', update);
  if (update.tableNumber) io.to(tableRoom(restaurantId, update.tableNumber)).emit('order-status-changed', update);
}

/**
 * Après un paiement : si toutes les commandes de la visite sont réglées (ou annulées), la visite se termine,
 * sa facture est créée et le client devra rescanner le QR code pour commander à nouveau.
 */
async function finalizeVisitIfPaid(restaurantId, sessionToken, tableNumber, cashierName = null) {
  if (!sessionToken) return;
  const remaining = await orders.activeOrdersOfSession(sessionToken);
  if (remaining.length > 0) return;
  const closed = await tableSessions.closeSession(sessionToken);
  const invoiceId = await invoices.createInvoiceForSession(restaurantId, sessionToken, cashierName);
  if (closed) io.to(tableRoom(restaurantId, tableNumber)).emit('session-closed', { tableNumber: String(tableNumber) });
  if (invoiceId) emitToStaff(restaurantId, 'invoice-created', { invoiceId, tableNumber: String(tableNumber) });
}

async function setOrderStatus(restaurantId, orderId, status, extra = {}) {
  if (!(await orders.updateOrderStatus(restaurantId, orderId, status))) return null;
  const saved = await orders.getOrder(restaurantId, orderId);
  if (!saved) return null;
  broadcastStatus(restaurantId, { ...extra, orderId, status, tableNumber: saved.table_number, timestamp: new Date().toISOString() });
  return saved;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(); // téléphone d'un client
  try {
    const account = await resolveAuth(token);
    if (!account) return next(new Error('unauthorized'));
    socket.data.token = token;
    next();
  } catch (error) {
    next(error);
  }
});

io.on('connection', (socket) => {
  /** Compte du personnel de cette connexion, revérifié à chaque action (un caissier désactivé perd la main aussitôt) */
  const staffOf = async () => {
    if (!socket.data.token) return null;
    const account = await resolveAuth(socket.data.token).catch(() => null);
    if (!account) socket.disconnect(true);
    return account;
  };

  // Caisses et admin
  socket.on('join-staff', async (first, second) => {
    const ack = typeof first === 'function' ? first : second;
    const reply = typeof ack === 'function' ? ack : () => {};
    const staff = await staffOf();
    if (!staff) return reply({ ok: false, reason: 'unauthorized' });
    socket.join([room(staff.restaurantId), staffRoom(staff.restaurantId)]);
    reply({ ok: true });
  });

  // Le client rejoint la salle de sa table à partir de son token de session
  socket.on('join-session', async (sessionToken, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const session = await tableSessions.getOpenSession(sessionToken);
      if (!session) return reply({ ok: false, reason: 'session_closed' });
      socket.join([room(session.restaurantId), tableRoom(session.restaurantId, session.tableNumber)]);
      reply({ ok: true, tableNumber: session.tableNumber });
    } catch (error) {
      console.error('join-session error:', error);
      reply({ ok: false, reason: 'server_error' });
    }
  });

  // Nouvelle commande : acceptée seulement avec une session de table ouverte (créée en scannant le QR code).
  // Le numéro de table vient de la session et les plats et prix du menu du restaurant, jamais de ce que le client envoie.
  socket.on('new-order', async (rawOrder, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    let session;
    try {
      session = await tableSessions.getOpenSession(rawOrder && rawOrder.sessionToken);
    } catch (error) {
      console.error('new-order session check error:', error);
      return reply({ ok: false, reason: 'server_error' });
    }
    if (!session) return reply({ ok: false, reason: 'session_closed' });
    try {
      const where = geofence.checkOrderPosition(await settings.getSettings(session.restaurantId), rawOrder && rawOrder.position);
      if (where !== 'ok') return reply({ ok: false, reason: where });
    } catch (error) {
      console.error('new-order position check error:', error);
      return reply({ ok: false, reason: 'server_error' });
    }
    await tableSessions.touchSession(session.token).catch(() => {});

    let result;
    try {
      result = await orders.saveOrder(session.restaurantId, rawOrder, session);
    } catch (error) {
      console.error('Error saving order:', error);
      return reply({ ok: false, reason: 'server_error' });
    }
    if (result.error) return reply({ ok: false, reason: result.error });
    const { order } = result;
    reply({ ok: true, tableNumber: session.tableNumber });

    emitToStaff(session.restaurantId, 'order-notification', {
      id: order.id, orderId: order.id, tableNumber: session.tableNumber, note: String(rawOrder.note || '').trim().slice(0, 500),
      items: order.items, total: order.total, timestamp: new Date().toISOString(),
    });
    // Les autres téléphones de la même table mettent à jour "Mes commandes"
    io.to(tableRoom(session.restaurantId, session.tableNumber)).emit('table-order-update', { orderId: order.id });
    console.log(`🆕 Order ${order.id} for table ${session.tableNumber} (restaurant ${session.restaurantId})`);
  });

  // Changement de statut d'une commande (caisse ou admin)
  socket.on('order-status-update', async (updateData) => {
    const staff = await staffOf();
    if (!staff || !updateData || !updateData.orderId) return;
    try {
      const saved = await setOrderStatus(staff.restaurantId, updateData.orderId, updateData.status);
      if (saved && updateData.status === 'paid') await finalizeVisitIfPaid(staff.restaurantId, saved.session_token, saved.table_number, staff.name);
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  });

  // Encaisser toute la table d'un coup : toutes les commandes de la visite sont payées, la facture est créée
  socket.on('pay-table', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const staff = await staffOf();
    if (!staff) return reply({ ok: false, reason: 'unauthorized' });
    try {
      const session = await tableSessions.getOpenSessionForTable(staff.restaurantId, data && data.tableNumber);
      if (!session) return reply({ ok: false, reason: 'no_session' });
      for (const order of await orders.activeOrdersOfSession(session.token)) {
        await setOrderStatus(staff.restaurantId, order.id, 'paid');
      }
      await finalizeVisitIfPaid(staff.restaurantId, session.token, session.tableNumber, staff.name);
      reply({ ok: true });
    } catch (error) {
      console.error('pay-table error:', error);
      reply({ ok: false, reason: 'server_error' });
    }
  });

  // Message libre de la caisse / de l'admin au client d'une table (affiché sur son téléphone avec un son)
  socket.on('staff-message', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const staff = await staffOf();
    if (!staff) return reply({ ok: false, reason: 'unauthorized' });
    try {
      const text = String((data && data.text) || '').trim().slice(0, 300);
      if (!text) return reply({ ok: false, reason: 'empty' });
      const session = await tableSessions.getOpenSessionForTable(staff.restaurantId, data.tableNumber);
      if (!session) return reply({ ok: false, reason: 'no_session' });
      const message = await invoices.saveTableMessage(staff.restaurantId, session.token, session.tableNumber, text, data.sender || staff.name);
      io.to(tableRoom(staff.restaurantId, session.tableNumber)).emit('staff-message', message);
      reply({ ok: true, message });
    } catch (error) {
      console.error('staff-message error:', error);
      reply({ ok: false, reason: 'server_error' });
    }
  });
});

async function startServer() {
  try {
    await initializeDatabase();
    if (process.env.SKIP_PASSWORD_MIGRATION !== '1') await migratePlainPasswords();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Saveur server running on http://localhost:${PORT}`);
      if (fs.existsSync(WEB_DIST)) {
        console.log(`   Client : http://localhost:${PORT}/`);
        console.log(`   Cashier: http://localhost:${PORT}/caisse/`);
        console.log(`   Login  : http://localhost:${PORT}/login`);
        const lan = lanAddresses()[0];
        if (lan) console.log(`   Phones (same Wi-Fi): http://${lan}:${PORT}/`);
      } else {
        console.log('   (API only — run "npm run dev" at the project root for the web interfaces)');
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

startServer();
