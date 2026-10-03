/**
 * Script d'insertion des 10 clés d'activation initiales dans la base de données.
 * Lancer une seule fois : node server/scripts/seed-license-keys.js
 */

// Load project config (reads server/config.env)
require('../config');
const { pool, initializeDatabase } = require('../database');

// 10 clés d'activation prêtes à distribuer aux restaurants
const KEYS = [
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

async function run() {
  await initializeDatabase();
  let inserted = 0;
  let skipped = 0;
  for (const key of KEYS) {
    try {
      const result = await pool.query(
        'INSERT IGNORE INTO license_keys (`key`) VALUES (?)',
        [key]
      );
      if (result[0].affectedRows > 0) {
        console.log(`  ✅ Inserted: ${key}`);
        inserted++;
      } else {
        console.log(`  ⏭️  Already exists: ${key}`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ❌ Error inserting ${key}:`, err.message);
    }
  }
  console.log(`\n✅ Done. Inserted: ${inserted}, Skipped: ${skipped}\n`);
  console.log('Keys to send to restaurants via WhatsApp:');
  console.log('─'.repeat(40));
  KEYS.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));
  console.log('─'.repeat(40));
  await pool.end();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
