const { run, get, all } = require('./database');
const { isValidTimezone, setTimezone, SERVER_TZ } = require('./tenant');

// Paramètres d'un restaurant, modifiables depuis le dashboard admin (section "Paramètres").

const CURRENCIES = ['EUR', 'USD', 'DZD'];

const DEFAULTS = {
  restaurant_name: '',
  restaurant_address: '',
  restaurant_phone: '',
  receipt_footer: 'Thank you for your visit!',
  currency: 'EUR', // devise des prix du menu, des factures et des rapports
  tax_enabled: false,
  tax_rate: 19, // %
  tax_mode: 'included', // 'included' = prix TTC (TVA comprise) | 'added' = TVA ajoutée au total
  service_type: 'none', // 'none' | 'fixed' = montant par table | 'percent' = % de l'addition
  service_value: 0,
};

const cache = new Map(); // restaurant -> paramètres

function parse(key, raw) {
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') return raw === '1' || raw === 'true';
  if (typeof def === 'number') return Number(raw) || 0;
  return raw ?? def;
}

async function getSettings(restaurantId) {
  let settings = cache.get(restaurantId);
  if (!settings) {
    const rows = await all('SELECT `key`, value FROM settings WHERE restaurant_id = ?', [restaurantId]);
    const restaurant = await get('SELECT name, timezone FROM restaurants WHERE id = ?', [restaurantId]);
    settings = { ...DEFAULTS };
    for (const row of rows) if (row.key in DEFAULTS) settings[row.key] = parse(row.key, row.value);
    if (!CURRENCIES.includes(settings.currency)) settings.currency = DEFAULTS.currency;
    settings.restaurant_name = settings.restaurant_name || (restaurant && restaurant.name) || 'My restaurant';
    settings.timezone = restaurant && isValidTimezone(restaurant.timezone) ? restaurant.timezone : SERVER_TZ;
    cache.set(restaurantId, settings);
  }
  return { ...settings };
}

/** Met à jour les paramètres fournis ; retourne { errors } si une valeur est invalide */
async function updateSettings(restaurantId, input) {
  const current = await getSettings(restaurantId);
  const errors = {};
  const next = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!(key in DEFAULTS)) continue;
    const def = DEFAULTS[key];
    if (typeof def === 'boolean') next[key] = Boolean(value);
    else if (typeof def === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) errors[key] = 'Invalid value';
      else next[key] = n;
    } else next[key] = String(value ?? '').trim().slice(0, 300);
  }
  const timezone = input && input.timezone !== undefined ? String(input.timezone).trim() : null;
  if (timezone !== null && !isValidTimezone(timezone)) errors.timezone = 'Unknown time zone';

  if ('restaurant_name' in next && !next.restaurant_name) errors.restaurant_name = 'Restaurant name is required';
  if ('currency' in next && !CURRENCIES.includes(next.currency)) errors.currency = 'Unsupported currency (EUR, USD or DZD)';
  if ('tax_rate' in next && next.tax_rate > 100) errors.tax_rate = 'The rate must be between 0 and 100';
  if ('tax_mode' in next && !['included', 'added'].includes(next.tax_mode)) errors.tax_mode = 'Invalid mode';
  if ('service_type' in next && !['none', 'fixed', 'percent'].includes(next.service_type)) errors.service_type = 'Invalid type';
  if ('service_value' in next && (next.service_type ?? current.service_type) === 'percent' && next.service_value > 100) {
    errors.service_value = 'The percentage must be between 0 and 100';
  }
  if (Object.keys(errors).length) return { errors };

  for (const [key, value] of Object.entries(next)) {
    const stored = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    await run(
      'INSERT INTO settings (restaurant_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [restaurantId, key, stored]
    );
  }
  if (next.restaurant_name) await run('UPDATE restaurants SET name = ? WHERE id = ?', [next.restaurant_name, restaurantId]);
  if (timezone !== null) await setTimezone(restaurantId, timezone);
  cache.delete(restaurantId);
  return { settings: await getSettings(restaurantId) };
}

const forgetSettings = (restaurantId) => cache.delete(restaurantId);

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Montant d'une addition à partir du sous-total des plats et des paramètres :
 * frais de table / service, puis TVA (comprise dans les prix ou ajoutée au total).
 * Même calcul que shared/bill.ts côté interfaces.
 * `tableTaxRate` : TVA propre à la table (0 à 100) ; null = taux du restaurant. Le mode (comprise / ajoutée) reste celui du restaurant.
 */
function computeBill(subtotal, settings, tableTaxRate = null) {
  const ownRate = tableTaxRate === null || tableTaxRate === undefined ? null : Number(tableTaxRate);
  const taxEnabled = ownRate !== null ? ownRate > 0 : Boolean(settings.tax_enabled && settings.tax_rate > 0);
  const taxRate = ownRate !== null ? ownRate : settings.tax_rate;
  let service = 0;
  let serviceLabel = null;
  if (settings.service_type === 'fixed' && settings.service_value > 0) {
    service = settings.service_value;
    serviceLabel = 'Table fee';
  } else if (settings.service_type === 'percent' && settings.service_value > 0) {
    service = subtotal * settings.service_value / 100;
    serviceLabel = `Service (${settings.service_value} %)`;
  }
  const base = subtotal + service;
  let tax = 0;
  let total = base;
  if (taxEnabled) {
    if (settings.tax_mode === 'added') {
      tax = base * taxRate / 100;
      total = base + tax;
    } else {
      tax = base - base / (1 + taxRate / 100); // part de TVA déjà comprise dans les prix
    }
  }
  return {
    subtotal: round2(subtotal),
    service: round2(service),
    serviceLabel,
    tax: round2(tax),
    taxRate: taxEnabled ? taxRate : 0,
    taxMode: taxEnabled ? settings.tax_mode : null,
    total: round2(total),
  };
}

module.exports = { CURRENCIES, getSettings, updateSettings, forgetSettings, computeBill };
