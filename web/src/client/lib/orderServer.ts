// Serveur (API, commandes temps réel, sessions de table) : même origine que la page par défaut.
// Surchargeable via VITE_ORDER_SERVER_URL si l'API est hébergée ailleurs.
export const ORDER_SERVER_URL: string = import.meta.env.VITE_ORDER_SERVER_URL || "";
