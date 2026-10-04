const { setting } = require('./config');

// Commande réservée aux clients présents au restaurant : la position envoyée avec la commande doit être
// à moins de MAX_DISTANCE_M mètres du point enregistré dans les paramètres (vide = pas de restriction).

const MAX_DISTANCE_M = Number(setting('ORDER_MAX_DISTANCE_METERS', 300)) || 300;
// Le GPS d'un téléphone est parfois approximatif : on tolère la marge d'erreur annoncée, plafonnée
const MAX_ACCURACY_SLACK_M = 100;

const toRad = (degrees) => (degrees * Math.PI) / 180;

/** Distance en mètres entre deux points (formule de haversine) */
function distanceMeters(a, b) {
  const earth = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

const validPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Point du restaurant { lat, lng }, ou null si l'admin n'a pas enregistré sa position */
function restaurantPoint(settings) {
  const raw = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value));
  const lat = raw(settings.location_lat);
  const lng = raw(settings.location_lng);
  return validPoint(lat, lng) ? { lat, lng } : null;
}

/** 'ok' | 'location_required' (position absente ou invalide) | 'too_far' */
function checkOrderPosition(settings, position) {
  const center = restaurantPoint(settings);
  if (!center) return 'ok';
  const lat = Number(position && position.lat);
  const lng = Number(position && position.lng);
  if (!validPoint(lat, lng)) return 'location_required';
  const accuracy = Math.min(Math.max(Number(position.accuracy) || 0, 0), MAX_ACCURACY_SLACK_M);
  return distanceMeters(center, { lat, lng }) - accuracy <= MAX_DISTANCE_M ? 'ok' : 'too_far';
}

module.exports = { MAX_DISTANCE_M, distanceMeters, restaurantPoint, checkOrderPosition };
