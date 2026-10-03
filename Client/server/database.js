const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Create SQLite database connection
const dbPath = path.join(__dirname, 'restaurant.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Create a simple pool-like interface for compatibility
const pool = {
  query: (text, params = []) => {
    return new Promise((resolve, reject) => {
      // SELECT and "... RETURNING" statements return rows, so they need db.all
      if (typeof text === 'string' && (text.trim().toUpperCase().startsWith('SELECT') || /\bRETURNING\b/i.test(text))) {
        db.all(text, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve({ rows });
          }
        });
      } else {
        db.run(text, params, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ rows: [], rowCount: this.changes });
          }
        });
      }
    });
  }
};

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create menu_items table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price REAL NOT NULL CHECK (price > 0),
        category TEXT NOT NULL,
        image_url TEXT,
        available INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create index for better performance
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
      CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(available);
    `;

    await pool.query(createTableQuery);
    await initializeSessionTables();
    await migrateBase64Images();
    console.log('✅ Database tables initialized successfully');



    // Insert sample data if table is empty
    const checkDataQuery = 'SELECT COUNT(*) as count FROM menu_items';
    const result = await pool.query(checkDataQuery);
    
    if (parseInt(result.rows[0].count) === 0) {
      await insertSampleData();
      console.log('✅ Sample data inserted successfully');
    }

  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
}



// Anciennes images enregistrées en base64 directement dans menu_items -> fichiers + chemin
async function migrateBase64Images() {
  const { normalizeImageUrl } = require('./imageStore');
  const { rows } = await pool.query("SELECT id, image_url FROM menu_items WHERE image_url LIKE 'data:image/%'");
  for (const row of rows) {
    await pool.query('UPDATE menu_items SET image_url = $1 WHERE id = $2', [normalizeImageUrl(row.image_url), row.id]);
  }
  if (rows.length > 0) {
    console.log(`✅ ${rows.length} image(s) base64 converted to files`);
  }
}

// Tables du restaurant (un QR code par table) et sessions de table (une par visite)
function initializeSessionTables() {
  return new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        number TEXT PRIMARY KEY,
        qr_token TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS table_sessions (
        token TEXT PRIMARY KEY,
        table_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_table_sessions_table_status ON table_sessions(table_number, status);

      -- Commandes enregistrées (pour l'historique et les statistiques du dashboard admin)
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        table_number TEXT NOT NULL,
        session_token TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        total REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        dish_id TEXT,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 1,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `, (err) => (err ? reject(err) : resolve()));
  });
}

// Insert sample menu items
async function insertSampleData() {
  const sampleItems = [
    {
      name: 'Steak Grillé',
      description: 'Filet de bœuf grillé aux légumes de saison, servi avec sauce au poivre',
      price: 28.50,
      category: 'Plats Principaux',
      image_url: null, // Will use fallback image from frontend
      available: true
    },
    {
      name: 'Salade César',
      description: 'Laitue romaine, parmesan, croûtons et sauce césar maison',
      price: 14.90,
      category: 'Salades',
      image_url: null, // Will use fallback image from frontend
      available: true
    },
    {
      name: 'Soupe à l\'Oignon',
      description: 'Soupe traditionnelle française au fromage fondu et croûtons dorés',
      price: 9.80,
      category: 'Entrées',
      image_url: null, // Will use fallback image from frontend
      available: true
    },
    {
      name: 'Dessert Chocolat',
      description: 'Fondant au chocolat avec fruits rouges et crème anglaise',
      price: 8.50,
      category: 'Desserts',
      image_url: null, // Will use fallback image from frontend
      available: true
    }
  ];

  for (const item of sampleItems) {
    const insertQuery = `
      INSERT INTO menu_items (name, description, price, category, image_url, available)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    await pool.query(insertQuery, [
      item.name,
      item.description,
      item.price,
      item.category,
      item.image_url,
      item.available
    ]);
  }
}

module.exports = {
  db,
  pool,
  initializeDatabase
};

