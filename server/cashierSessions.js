// Présence des caissiers connectés, gardée en mémoire : id du caissier -> session (avec son restaurant).
// Sert à savoir qui est « en ligne » (admin) et qui travaillait lors d'une réclamation.

const SESSION_HOURS = 8;
const ACTIVE_MINUTES = 30;
const ON_DUTY_MINUTES = 5;

const sessions = new Map();

function start({ id, restaurantId, name }) {
  const now = new Date().toISOString();
  sessions.set(id, { id, restaurantId, name, login_time: now, last_activity: now });
}

/** Signal de présence : le caissier reste « en service », même après un redémarrage du serveur */
function heartbeat({ id, restaurantId, name }) {
  const existing = sessions.get(id);
  const now = new Date().toISOString();
  sessions.set(id, { id, restaurantId, name, login_time: existing ? existing.login_time : now, last_activity: now });
}

const end = (id) => sessions.delete(id);

/** Sessions encore valides du restaurant ; les expirées sont retirées */
function live(restaurantId) {
  const now = Date.now();
  const active = [];
  for (const [id, session] of sessions) {
    const loginAge = now - Date.parse(session.login_time);
    const idle = now - Date.parse(session.last_activity);
    if (loginAge > SESSION_HOURS * 3600e3 || idle > ACTIVE_MINUTES * 60e3) sessions.delete(id);
    else if (session.restaurantId === restaurantId) active.push(session);
  }
  return active;
}

/** Caissiers en service dans CE restaurant : signal de présence reçu il y a moins de 5 minutes */
function onDutyNames(restaurantId) {
  const now = Date.now();
  return [...sessions.values()]
    .filter((session) => session.restaurantId === restaurantId && now - Date.parse(session.last_activity) < ON_DUTY_MINUTES * 60e3)
    .map((session) => session.name);
}

module.exports = { start, heartbeat, end, live, onDutyNames };
