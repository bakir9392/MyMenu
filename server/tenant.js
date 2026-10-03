const { get, run } = require('./database');

// Contexte d'un restaurant pour les requêtes de dates : chaque restaurant a son fuseau horaire, et les mots
// « aujourd'hui », « ce mois-ci », « cette heure » s'entendent dans ce fuseau (les dates restent stockées en UTC).

const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Décalage de `tz` par rapport à l'UTC en minutes, à l'instant donné (tient compte de l'heure d'été) */
function offsetMinutes(tz, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function offsetString(tz, date = new Date()) {
  const minutes = offsetMinutes(tz, date);
  const abs = Math.abs(minutes);
  return `${minutes >= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Date du jour dans le fuseau, "AAAA-MM-JJ" */
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const timezones = new Map(); // restaurant -> { tz, at }
const TTL_MS = 60 * 1000;

async function timezoneOf(restaurantId) {
  const cached = timezones.get(restaurantId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.tz;
  const row = await get('SELECT timezone FROM restaurants WHERE id = ?', [restaurantId]);
  const tz = row && isValidTimezone(row.timezone) ? row.timezone : SERVER_TZ;
  timezones.set(restaurantId, { tz, at: Date.now() });
  return tz;
}

async function setTimezone(restaurantId, tz) {
  await run('UPDATE restaurants SET timezone = ? WHERE id = ?', [tz, restaurantId]);
  timezones.delete(restaurantId);
}

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Outils SQL d'un restaurant. `local(col)` convertit une colonne UTC dans son fuseau ; `periodFilter` traduit
 * today | week (7 jours) | last30 (30 jours) | month | year | all ; `periodRange` donne les bornes de la période en dates locales.
 */
async function tenantCtx(restaurantId) {
  const tz = await timezoneOf(restaurantId);
  const offset = offsetString(tz);
  const local = (column) => `CONVERT_TZ(${column}, '+00:00', '${offset}')`;
  const nowLocal = () => `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${offset}')`;
  const today = todayIn(tz);

  return {
    rid: restaurantId,
    tz,
    offset,
    today,
    local,
    nowLocal,
    periodFilter(period, column = 'created_at') {
      const c = local(column);
      switch (period) {
        case 'week': return `${c} >= DATE(${nowLocal()}) - INTERVAL 6 DAY`;
        case 'last30': return `${c} >= DATE(${nowLocal()}) - INTERVAL 29 DAY`;
        case 'month': return `${c} >= DATE_FORMAT(${nowLocal()}, '%Y-%m-01')`;
        case 'year': return `${c} >= DATE_FORMAT(${nowLocal()}, '%Y-01-01')`;
        case 'all': return '1 = 1';
        default: return `DATE(${c}) = DATE(${nowLocal()})`; // aujourd'hui
      }
    },
    periodRange(period) {
      switch (period) {
        case 'week': return { from: addDays(today, -6), to: today };
        case 'last30': return { from: addDays(today, -29), to: today };
        case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
        case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
        case 'all': return { from: null, to: today };
        default: return { from: today, to: today };
      }
    },
  };
}

module.exports = { tenantCtx, timezoneOf, setTimezone, isValidTimezone, SERVER_TZ, todayIn, addDays };
