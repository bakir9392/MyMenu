// Serveur : commandes en temps réel, tables / QR codes, statistiques. Même origine que la page par défaut,
// surchargeable via VITE_ORDER_SERVER_URL.
export const ORDER_SERVER_URL: string = import.meta.env.VITE_ORDER_SERVER_URL || "";

export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "served" | "paid" | "cancelled";

export interface OrderItem {
  dish_id?: string | null;
  name: string;
  price: number;
  quantity: number;
  notes?: string | null;
}

export interface Order {
  id: string;
  table_number: string;
  status: OrderStatus;
  total: number;
  /** Texte saisi par le client avec sa commande */
  note?: string | null;
  created_at: string;
  items: OrderItem[];
}

export interface RestaurantTable {
  number: string;
  qr_token: string;
  has_open_session: boolean;
  /** TVA propre à cette table (0-100) ; null = taux du restaurant. Modifiable par l'admin seulement. */
  tax_rate: number | null;
}

export interface RestaurantStats {
  period: string;
  summary: {
    orders_count: number;
    paid_orders: number;
    cancelled_orders: number;
    revenue: number;
    average_ticket: number;
    tables_served: number;
  };
  topDishes: { name: string; quantity: number; revenue: number }[];
  timeline: { label: string; orders: number; revenue: number }[];
  live: { active_orders: number; pending_orders: number; occupied_tables: number; total_tables: number };
}

export async function orderApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ORDER_SERVER_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { code: body.code as string | undefined, data: body.data });
  }
  return body.data as T;
}

/** Dates enregistrées par le serveur en UTC ("YYYY-MM-DD HH:MM:SS") -> Date */
export { parseServerDate } from "../../shared/i18n";
