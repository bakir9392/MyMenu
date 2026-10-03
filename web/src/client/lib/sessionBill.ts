import type { SessionBill } from "@/lib/bill";
import { ORDER_SERVER_URL } from "@/lib/orderServer";

export type BillResult =
  | { ok: true; bill: SessionBill }
  | { ok: false; reason: "nothing_to_bill" | "network" };

/** Addition de la visite (GET /api/sessions/:token/bill) : distingue « rien à facturer » (404) d'une panne réseau */
export async function loadSessionBill(sessionToken: string): Promise<BillResult> {
  try {
    const response = await fetch(`${ORDER_SERVER_URL}/api/sessions/${encodeURIComponent(sessionToken)}/bill`);
    if (response.status === 404) return { ok: false, reason: "nothing_to_bill" };
    if (!response.ok) return { ok: false, reason: "network" };
    const body = await response.json();
    return body?.data ? { ok: true, bill: body.data as SessionBill } : { ok: false, reason: "nothing_to_bill" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
