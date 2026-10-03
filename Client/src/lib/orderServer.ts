// Serveur Node (commandes temps réel, sessions de table). Par défaut : même machine que la page, port 3001,
// pour que les téléphones du réseau local fonctionnent aussi. Surchargeable via VITE_ORDER_SERVER_URL.
export const ORDER_SERVER_URL: string =
  import.meta.env.VITE_ORDER_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
