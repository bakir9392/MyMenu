const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Import database and routes
const { initializeDatabase } = require('./database');
const menuItemsRoutes = require('./routes/menuItems');
const imagesRoutes = require('./routes/images');
const tablesRoutes = require('./routes/tables');
const tableSessions = require('./tableSessions');
const orders = require('./orders');
const ordersRoutes = require('./routes/orders');

// Read config file
const configPath = path.join(__dirname, 'config.env');
const configContent = fs.readFileSync(configPath, 'utf8');
const config = {};

configContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value && !key.startsWith('#')) {
    config[key.trim()] = value.trim();
  }
});

const app = express();
const server = createServer(app);
// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: true, // Allow all origins for testing
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

const PORT = config.PORT || 3001;

// Middleware
// Security headers (les images sont affichées par les fronts qui tournent sur d'autres ports)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Handle preflight requests
app.options('*', cors());

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins for testing
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(morgan('combined')); // Logging



// Increase payload limits for large images
app.use(express.json({ limit: '500mb' })); // Parse JSON bodies (very high limit)
app.use(express.urlencoded({ extended: true, limit: '500mb' })); // Parse URL-encoded bodies (very high limit)

// Add timeout settings for large uploads
app.use((req, res, next) => {
  req.setTimeout(300000); // 5 minutes timeout
  res.setTimeout(300000); // 5 minutes timeout
  next();
});

// Images des plats, servies comme fichiers statiques (mises en cache par le navigateur)
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), { maxAge: '7d' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV || 'development',
    database: {
      host: config.DB_HOST,
      port: config.DB_PORT,
      name: config.DB_NAME
    }
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // Join table room
  socket.on('join-table', (tableNumber) => {
    socket.join(`table-${tableNumber}`);
    console.log(`📋 Client ${socket.id} joined table ${tableNumber}`);
  });

  // Le client rejoint la salle de sa table à partir de son token de session
  socket.on('join-session', async (sessionToken, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const session = await tableSessions.getOpenSession(sessionToken);
      if (!session) return reply({ ok: false, reason: 'session_closed' });
      socket.join(`table-${session.tableNumber}`);
      reply({ ok: true, tableNumber: session.tableNumber });
    } catch (error) {
      console.error('join-session error:', error);
      reply({ ok: false, reason: 'server_error' });
    }
  });
  
  // Handle new order
  socket.on('new-order', async (rawOrder, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    // Une commande n'est acceptée qu'avec une session de table ouverte (créée en scannant le QR code).
    // Le numéro de table vient de la session, jamais de ce que le client envoie.
    let session;
    try {
      session = await tableSessions.getOpenSession(rawOrder && rawOrder.sessionToken);
    } catch (error) {
      console.error('new-order session check error:', error);
      return reply({ ok: false, reason: 'server_error' });
    }
    if (!session) {
      console.log('⛔ Server: Order rejected (no open table session)');
      return reply({ ok: false, reason: 'session_closed' });
    }
    await tableSessions.touchSession(session.token).catch(() => {});

    const { sessionToken, ...orderWithoutToken } = rawOrder;
    const orderData = { ...orderWithoutToken, tableNumber: session.tableNumber };
    try {
      orderData.total = await orders.saveOrder(orderData, session.token);
    } catch (error) {
      console.error('Error saving order:', error);
      return reply({ ok: false, reason: 'server_error' });
    }
    reply({ ok: true, tableNumber: session.tableNumber });

    console.log('🆕 Server: New order received:', orderData);
    console.log('🆕 Server: Order details:', {
      id: orderData.id,
      tableNumber: orderData.tableNumber,
      itemsCount: orderData.items.length,
      total: orderData.total
    });
    
    // Use the id sent by the client as orderId
    const orderNotification = {
      ...orderData,
      timestamp: new Date().toISOString(),
      orderId: orderData.id // Use the client's id as orderId
    };
    
    console.log('🆕 Server: Sending order notification with orderId:', orderNotification.orderId);
    
    // Emit to all clients (cashier interface)
    io.emit('order-notification', orderNotification);
    
    // Also emit to specific table room if table number is provided
    if (orderData.tableNumber) {
      io.to(`table-${orderData.tableNumber}`).emit('table-order-update', {
        ...orderData,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('🆕 Server: Order notification sent successfully');
  });
  
  // Handle order status updates
  socket.on('order-status-update', async (updateData) => {
    console.log('📊 Server: Order status update received:', updateData);
    console.log('📊 Server: Update details:', {
      orderId: updateData.orderId,
      tableNumber: updateData.tableNumber,
      status: updateData.status,
      timestamp: updateData.timestamp
    });
    
    // Le numéro de table enregistré fait foi
    try {
      await orders.updateOrderStatus(updateData.orderId, updateData.status);
      const saved = await orders.getOrder(updateData.orderId);
      if (saved) updateData = { ...updateData, tableNumber: saved.table_number };
    } catch (error) {
      console.error('Error updating order status:', error);
    }

    // Emit to all clients
    console.log('📊 Server: Emitting order-status-changed to all clients');
    io.emit('order-status-changed', updateData);
    
    // Emit to specific table if provided
    if (updateData.tableNumber) {
      console.log(`📊 Server: Emitting table-status-update to table ${updateData.tableNumber}`);
      io.to(`table-${updateData.tableNumber}`).emit('table-status-update', updateData);
    }
    
    // Paiement : la visite est terminée, le client devra rescanner le QR code pour commander à nouveau
    if (updateData.status === 'paid' && updateData.tableNumber) {
      try {
        const closed = await tableSessions.closeTableSession(updateData.tableNumber);
        if (closed > 0) {
          io.to(`table-${updateData.tableNumber}`).emit('session-closed', { tableNumber: String(updateData.tableNumber) });
          console.log(`🔒 Server: Session closed for table ${updateData.tableNumber}`);
        }
      } catch (error) {
        console.error('Error closing table session:', error);
      }
    }
    
    console.log('📊 Server: Order status update processed successfully');
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// API Routes
app.use('/api/menu-items', menuItemsRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api', tablesRoutes);
app.use('/api', ordersRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Menu Magique Restaurant Management API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      menuItems: '/api/menu-items',
      documentation: 'Available endpoints for menu management'
    },
    timestamp: new Date().toISOString()
  });
});



// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  res.status(error.status || 500).json({
    success: false,
    error: 'Internal server error',
    message: error.message || 'Something went wrong on the server',
    ...(config.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 Menu Magique Server started successfully!');
      console.log(`📍 Server running on port ${PORT}`);
      console.log(`🌐 API available at http://0.0.0.0:${PORT}`);
      console.log(`🔍 Health check: http://0.0.0.0:${PORT}/api/health`);
      console.log(`📊 Menu items API: http://0.0.0.0:${PORT}/api/menu-items`);
      console.log(`🔌 Socket.IO enabled for real-time communication`);
      console.log(`🌍 Accessible from any IP address on port ${PORT}`);
      console.log(`🔗 Ngrok URL: https://119fefdb55e0.ngrok-free.app`);
      console.log('✅ Ready to handle requests and Socket.IO connections!');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
