// Migration unique : copie les données de l'ancienne base SQLite (restaurant.db) vers MySQL.
// Usage (depuis server/) : node scripts/migrate-sqlite-to-mysql.js [chemin/vers/restaurant.db]
// Les ids sont conservés ; les lignes déjà présentes dans MySQL sont ignorées (INSERT IGNORE).
// Les données de l'ancienne base appartiennent au restaurant n° RESTAURANT_ID (1 par défaut), repris ensuite par le premier compte admin.

const path = require('path');
const sqlite3 = require('sqlite3');
const { pool, initializeDatabase, newRestaurantCode } = require('../database');

const RESTAURANT_ID = Number(process.env.RESTAURANT_ID || 1);

// Ordre des clés étrangères
const TABLES = [
  'dishes', 'ratings', 'cashiers', 'restaurant_tables', 'table_sessions', 'orders', 'order_items',
  'invoices', 'invoice_items', 'table_messages', 'complaints', 'settings',
];

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'restaurant.db'));
const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY);
const sqliteAll = (sql) => new Promise((resolve, reject) => db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows))));

// Dates ISO (2025-01-31T10:00:00.000Z) -> format DATETIME MySQL (UTC)
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const normalize = (value) => (typeof value === 'string' && ISO.test(value)
  ? value.replace('T', ' ').replace(/(\.\d+)?Z$/, '').slice(0, 19)
  : value);

async function main() {
  await initializeDatabase();
  await pool.query('INSERT IGNORE INTO restaurants (id, code, name) VALUES (?, ?, ?)', [RESTAURANT_ID, newRestaurantCode(), 'My restaurant']);
  const existing = new Set((await sqliteAll("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name));

  for (const table of TABLES) {
    if (!existing.has(table)) { console.log(`- ${table}: absente de SQLite`); continue; }
    const [columnsInfo] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    const mysqlColumns = new Set(columnsInfo.map((c) => c.Field));
    const rows = await sqliteAll(`SELECT * FROM "${table}"`);
    if (rows.length === 0) { console.log(`- ${table}: 0 ligne`); continue; }

    const columns = Object.keys(rows[0]).filter((c) => mysqlColumns.has(c));
    const addRestaurant = mysqlColumns.has('restaurant_id') && !columns.includes('restaurant_id');
    if (addRestaurant) columns.push('restaurant_id');
    const sql = `INSERT IGNORE INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ?`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((row) => columns.map((c) => (c === 'restaurant_id' && addRestaurant ? RESTAURANT_ID : normalize(row[c]))));
      const [result] = await pool.query(sql, [chunk]);
      inserted += result.affectedRows;
    }
    console.log(`- ${table}: ${inserted}/${rows.length} ligne(s) copiée(s)`);
  }

  // Les compteurs AUTO_INCREMENT reprennent après le plus grand id copié (InnoDB le fait déjà ; on s'en assure)
  for (const table of TABLES) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${table}\` WHERE Extra LIKE '%auto_increment%'`);
    if (cols.length === 0) continue;
    const [[{ next }]] = await pool.query(`SELECT COALESCE(MAX(\`${cols[0].Field}\`), 0) + 1 AS next FROM \`${table}\``);
    await pool.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${Number(next)}`);
  }
}

main()
  .then(() => console.log('Migration terminée.'))
  .catch((err) => { console.error('Échec de la migration :', err.message); process.exitCode = 1; })
  .finally(() => { db.close(); pool.end(); });
