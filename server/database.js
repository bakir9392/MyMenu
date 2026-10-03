const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { config, setting } = require('./config');

// Base de données MySQL (menu, notes, caissiers, tables, sessions, commandes, factures...).
// Une même base sert plusieurs restaurants : chaque table métier porte un `restaurant_id` et toutes les
// requêtes en tiennent compte (voir tenant.js). Connexion dans config.env : DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
// Les dates sont stockées en UTC ; les regroupements par jour / heure se font dans le fuseau du restaurant.

const pool = mysql.createPool({
  host: setting('Host') || setting('DB_HOST', '127.0.0.1'),
  port: Number(setting('DB_PORT', 3306)),
  database: setting('DB_NAME', 'menu_magique'),
  user: setting('User') || setting('DB_USER', 'menu_magique'),
  password: setting('Password') || setting('DB_PASSWORD', ''),
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true, // dates renvoyées comme "AAAA-MM-JJ HH:MM:SS" (UTC), format attendu par les interfaces
  decimalNumbers: true, // montants DECIMAL renvoyés comme nombres
  connectionLimit: 10,
  waitForConnections: true,
});

// Chaque connexion travaille en UTC
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

const executor = (target) => ({
  /** Exécute une requête d'écriture ; { changes, lastID } (lignes modifiées, id inséré) */
  async run(sql, params = []) {
    const [result] = await target.query(sql, params);
    return { changes: result.affectedRows, lastID: result.insertId };
  },
  async get(sql, params = []) {
    const [rows] = await target.query(sql, params);
    return rows[0];
  },
  async all(sql, params = []) {
    const [rows] = await target.query(sql, params);
    return rows;
  },
});

const { run, get, all } = executor(pool);

/** Plusieurs requêtes sur une même connexion, validées ou annulées ensemble : fn reçoit { run, get, all } */
async function transaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(executor(connection));
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// Code que les caissiers saisissent pour rejoindre leur restaurant (sans caractères ambigus : 0/O, 1/I)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRestaurantCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

// Schéma d'une installation neuve. Une base existante (un seul restaurant) est mise à niveau par migrate().
const SCHEMA = [
  // Restaurants : un compte admin et ses caissiers, son menu, ses tables, ses commandes et ses factures
  `CREATE TABLE IF NOT EXISTS restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(12) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(64) NULL,
    invoice_seq INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name VARCHAR(191) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admins_restaurant (restaurant_id),
    CONSTRAINT fk_admins_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  // Menu (plats), partagé par le menu client, la caisse et l'admin du même restaurant
  `CREATE TABLE IF NOT EXISTS dishes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    category VARCHAR(100) NULL,
    images TEXT NULL,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    average_rating DECIMAL(4,2) NOT NULL DEFAULT 0,
    total_ratings INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dishes_restaurant (restaurant_id, category)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dish_id INT NOT NULL,
    rating TINYINT NOT NULL,
    user_identifier VARCHAR(100) NOT NULL,
    comment TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ratings_dish_user (dish_id, user_identifier),
    CONSTRAINT fk_ratings_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
    CONSTRAINT chk_ratings_value CHECK (rating BETWEEN 1 AND 5)
  ) ${TABLE_OPTIONS}`,

  // Caissiers d'un restaurant (mot de passe haché avec bcrypt)
  `CREATE TABLE IF NOT EXISTS cashiers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name VARCHAR(191) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_enc TEXT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(255) NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cashiers_restaurant_name (restaurant_id, name)
  ) ${TABLE_OPTIONS}`,

  // Tables du restaurant (un QR code par table) et sessions de table (une par visite)
  `CREATE TABLE IF NOT EXISTS restaurant_tables (
    restaurant_id INT NOT NULL,
    number VARCHAR(50) NOT NULL,
    qr_token VARCHAR(64) NOT NULL UNIQUE,
    tax_rate DECIMAL(5,2) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (restaurant_id, number)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS table_sessions (
    token VARCHAR(64) PRIMARY KEY,
    restaurant_id INT NOT NULL,
    table_number VARCHAR(50) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    INDEX idx_table_sessions_table_status (restaurant_id, table_number, status)
  ) ${TABLE_OPTIONS}`,

  // Commandes (historique et statistiques)
  `CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(100) PRIMARY KEY,
    restaurant_id INT NOT NULL,
    table_number VARCHAR(50) NOT NULL,
    session_token VARCHAR(64) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    note TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME NULL,
    INDEX idx_orders_restaurant_status (restaurant_id, status),
    INDEX idx_orders_restaurant_created (restaurant_id, created_at),
    INDEX idx_orders_session (session_token)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL,
    dish_id VARCHAR(50) NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    notes TEXT NULL,
    INDEX idx_order_items_order (order_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  // Factures : une par visite encaissée, numérotation continue par restaurant ; détail des montants figé à l'encaissement
  `CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    number VARCHAR(30) NULL,
    session_token VARCHAR(64) NULL UNIQUE,
    table_number VARCHAR(50) NOT NULL,
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    cashier_name VARCHAR(100) NULL,
    subtotal DECIMAL(10,2) NULL,
    service_amount DECIMAL(10,2) NULL,
    service_label VARCHAR(100) NULL,
    tax_amount DECIMAL(10,2) NULL,
    tax_rate DECIMAL(5,2) NULL,
    tax_mode VARCHAR(10) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_invoices_restaurant_number (restaurant_id, number),
    INDEX idx_invoices_restaurant_created (restaurant_id, created_at)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS invoice_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  // Messages envoyés par la caisse / l'admin au client d'une table
  `CREATE TABLE IF NOT EXISTS table_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    table_number VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    sender VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_table_messages_session (session_token)
  ) ${TABLE_OPTIONS}`,

  // Réclamations des clients (table, date, caissier(s) en service)
  `CREATE TABLE IF NOT EXISTS complaints (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    session_token VARCHAR(64) NULL,
    table_number VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    cashier_names VARCHAR(500) NULL,
    status ENUM('new', 'resolved') NOT NULL DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    INDEX idx_complaints_restaurant_created (restaurant_id, created_at)
  ) ${TABLE_OPTIONS}`,

  // Paramètres d'un restaurant (nom, coordonnées, devise, TVA, frais de table)
  `CREATE TABLE IF NOT EXISTS settings (
    restaurant_id INT NOT NULL,
    \`key\` VARCHAR(64) NOT NULL,
    value TEXT NULL,
    PRIMARY KEY (restaurant_id, \`key\`)
  ) ${TABLE_OPTIONS}`,

  // Clés d'activation (licence mensuelle). Chaque clé est utilisée par un seul restaurant.
  `CREATE TABLE IF NOT EXISTS license_keys (
    \`key\` VARCHAR(32) NOT NULL PRIMARY KEY,
    used_by_restaurant INT NULL,
    activated_at DATETIME NULL,
    expires_at DATETIME NULL,
    admin_id INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_license_restaurant FOREIGN KEY (used_by_restaurant) REFERENCES restaurants(id) ON DELETE SET NULL
  ) ${TABLE_OPTIONS}`,

  // Jetons de réinitialisation de mot de passe (expirés après 30 minutes)
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token VARCHAR(64) NOT NULL PRIMARY KEY,
    admin_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prt_admin (admin_id)
  ) ${TABLE_OPTIONS}`,
];

// ---- Mise à niveau d'une base créée quand il n'y avait qu'un seul restaurant ----

const TENANT_TABLES = [
  'dishes', 'cashiers', 'restaurant_tables', 'table_sessions', 'orders', 'invoices', 'table_messages', 'complaints', 'settings',
];

const columnExists = async (table, column) => Boolean(await get(
  'SELECT 1 AS found FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
  [table, column]
));

/** Index d'une table avec leurs colonnes, dans l'ordre : { nom: { unique, columns } } */
async function indexesOf(table) {
  const rows = await all(
    `SELECT index_name AS name, non_unique AS nonUnique, column_name AS \`column\`
     FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name, seq_in_index`,
    [table]
  );
  const indexes = {};
  for (const row of rows) {
    (indexes[row.name] ||= { unique: !row.nonUnique, columns: [] }).columns.push(row.column);
  }
  return indexes;
}

const sameColumns = (a, b) => a.length === b.length && a.every((column, i) => column === b[i]);

async function ensureIndex(table, name, columns, unique = false) {
  if ((await indexesOf(table))[name]) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD ${unique ? 'UNIQUE ' : ''}INDEX \`${name}\` (${columns.map((c) => `\`${c}\``).join(', ')})`);
}

async function migrateToMultiRestaurant() {
  const legacy = [];
  for (const table of TENANT_TABLES) if (!(await columnExists(table, 'restaurant_id'))) legacy.push(table);
  if (legacy.length === 0) return;

  // Les données déjà là appartiennent au restaurant n° 1, repris par le premier compte admin créé
  let hasData = false;
  for (const table of legacy) {
    if ((await get(`SELECT COUNT(*) AS n FROM \`${table}\``)).n > 0) hasData = true;
  }
  if (hasData) {
    let name = setting('RESTAURANT_NAME', 'My restaurant');
    if (legacy.includes('settings')) {
      const row = await get("SELECT value FROM settings WHERE `key` = 'restaurant_name'");
      if (row && row.value) name = row.value;
    }
    const lastInvoice = legacy.includes('invoices') ? (await get('SELECT COALESCE(MAX(id), 0) AS id FROM invoices')).id : 0;
    await run('INSERT IGNORE INTO restaurants (id, code, name, invoice_seq) VALUES (1, ?, ?, ?)', [newRestaurantCode(), name, lastInvoice]);
  }

  for (const table of legacy) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN restaurant_id INT NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE \`${table}\` ALTER COLUMN restaurant_id DROP DEFAULT`); // les nouvelles lignes doivent préciser leur restaurant
  }

  if (legacy.includes('restaurant_tables')) {
    await pool.query('ALTER TABLE restaurant_tables DROP PRIMARY KEY, ADD PRIMARY KEY (restaurant_id, number)');
  }
  if (legacy.includes('settings')) {
    await pool.query('ALTER TABLE settings DROP PRIMARY KEY, ADD PRIMARY KEY (restaurant_id, `key`)');
  }
  if (legacy.includes('cashiers')) {
    for (const [name, index] of Object.entries(await indexesOf('cashiers'))) {
      if (index.unique && sameColumns(index.columns, ['name'])) await pool.query(`ALTER TABLE cashiers DROP INDEX \`${name}\``);
    }
    await ensureIndex('cashiers', 'uq_cashiers_restaurant_name', ['restaurant_id', 'name'], true);
  }
  if (legacy.includes('invoices')) {
    for (const [name, index] of Object.entries(await indexesOf('invoices'))) {
      if (index.unique && sameColumns(index.columns, ['number'])) await pool.query(`ALTER TABLE invoices DROP INDEX \`${name}\``);
    }
    await ensureIndex('invoices', 'uq_invoices_restaurant_number', ['restaurant_id', 'number'], true);
  }
  console.log(`✅ Database upgraded for several restaurants (${legacy.length} tables)${hasData ? ', existing data kept as restaurant #1' : ''}`);
}

/** TVA propre à une table (NULL = taux du restaurant) */
async function ensureTableTaxColumn() {
  if (!(await columnExists('restaurant_tables', 'tax_rate'))) {
    await pool.query('ALTER TABLE restaurant_tables ADD COLUMN tax_rate DECIMAL(5,2) NULL AFTER qr_token');
  }
}

/** Copie chiffrée du mot de passe d'un caissier (lisible par l'admin), et recherche par e-mail à la connexion */
async function ensureCashierColumns() {
  if (!(await columnExists('cashiers', 'password_enc'))) {
    await pool.query('ALTER TABLE cashiers ADD COLUMN password_enc TEXT NULL AFTER password_hash');
  }
  await ensureIndex('cashiers', 'idx_cashiers_email', ['email']);
}

/** Chaque clé d'activation est liée à l'admin qui l'a activée : elle sert aussi à prouver son identité (mot de passe oublié) */
async function ensureLicenseAdminLink() {
  if (!(await columnExists('license_keys', 'admin_id'))) {
    await pool.query('ALTER TABLE license_keys ADD COLUMN admin_id INT NULL AFTER expires_at');
  }
  await ensureIndex('license_keys', 'idx_license_admin', ['admin_id']);
  // Les clés déjà activées avant ce lien : l'admin de leur restaurant
  await pool.query(
    `UPDATE license_keys k JOIN admins a ON a.restaurant_id = k.used_by_restaurant
     SET k.admin_id = a.id WHERE k.used_by_restaurant IS NOT NULL AND k.admin_id IS NULL`
  );
}

async function ensureIndexes() {
  await ensureIndex('dishes', 'idx_dishes_restaurant', ['restaurant_id', 'category']);
  await ensureIndex('table_sessions', 'idx_table_sessions_table_status', ['restaurant_id', 'table_number', 'status']);
  await ensureIndex('orders', 'idx_orders_restaurant_status', ['restaurant_id', 'status']);
  await ensureIndex('orders', 'idx_orders_restaurant_created', ['restaurant_id', 'created_at']);
  await ensureIndex('invoices', 'idx_invoices_restaurant_created', ['restaurant_id', 'created_at']);
  await ensureIndex('complaints', 'idx_complaints_restaurant_created', ['restaurant_id', 'created_at']);
}

async function initializeDatabase() {
  for (const statement of SCHEMA) await pool.query(statement);
  await migrateToMultiRestaurant();
  await ensureTableTaxColumn();
  await ensureCashierColumns();
  await ensureLicenseAdminLink();
  await ensureIndexes();
  await seedLicenseKeys();
  console.log('✅ Connected to MySQL, tables ready');
}

// ---- Clés d'activation pré-générées (auto-insérées au démarrage si absentes) ----
// INSERT IGNORE = ne touche pas aux clés déjà existantes ou déjà utilisées.
const PRESET_LICENSE_KEYS = [
  'MM26-ALFA-X9K2-PRO1',
  'MM26-BETA-W7M5-PRO2',
  'MM26-GAMA-Z3N8-PRO3',
  'MM26-DELT-Q6P4-PRO4',
  'MM26-EPSI-Y2L7-PRO5',
  'MM26-ZETA-J5H1-PRO6',
  'MM26-TETA-V8B3-PRO7',
  'MM26-IOTA-U4C6-PRO8',
  'MM26-KAPA-R1D9-PRO9',
  'MM26-LAMB-S0F2-PR10',
];

async function seedLicenseKeys() {
  let inserted = 0;
  for (const key of PRESET_LICENSE_KEYS) {
    const result = await run('INSERT IGNORE INTO license_keys (`key`) VALUES (?)', [key]);
    if (result.changes > 0) inserted++;
  }
  if (inserted > 0) console.log(`✅ Seeded ${inserted} new licence key(s)`);
}

module.exports = { pool, run, get, all, transaction, newRestaurantCode, initializeDatabase };
