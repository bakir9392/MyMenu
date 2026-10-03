const { get, all, run, pool } = require('./database');
const { encryptSecret } = require('./auth');

// Les mots de passe de caissiers que l'admin peut relire étaient stockés en clair (colonne plain_password) :
// on les chiffre (password_enc) puis on supprime la colonne en clair.
async function migratePlainPasswords() {
  const column = await get(
    "SELECT 1 AS found FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'cashiers' AND column_name = 'plain_password'"
  );
  if (!column) return;
  const rows = await all('SELECT id, plain_password FROM cashiers WHERE plain_password IS NOT NULL AND plain_password != \'\' AND password_enc IS NULL');
  for (const row of rows) await run('UPDATE cashiers SET password_enc = ? WHERE id = ?', [encryptSecret(row.plain_password), row.id]);
  await pool.query('ALTER TABLE cashiers DROP COLUMN plain_password');
  console.log(`🔒 ${rows.length} cashier password(s) re-encrypted, plain_password column removed`);
}

module.exports = { migratePlainPasswords };
