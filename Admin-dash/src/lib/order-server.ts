// Serveur Node : commandes en temps réel, tables / QR codes, statistiques.
// Par défaut, port 3001 de la machine qui sert cette page ; surchargeable via VITE_ORDER_SERVER_URL.
export const ORDER_SERVER_URL: string =
  import.meta.env.VITE_ORDER_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

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
  created_at: string;
  items: OrderItem[];
}

export interface RestaurantTable {
  number: string;
  qr_token: string;
  has_open_session: boolean;
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
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body.data as T;
}

/** Dates enregistrées par SQLite en UTC ("YYYY-MM-DD HH:MM:SS") -> Date locale */
export const parseServerDate = (value: string) => new Date(value.replace(" ", "T") + "Z");
