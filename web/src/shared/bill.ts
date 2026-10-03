import { useEffect, useState } from "react";
import type { Translate } from "./i18n";

// Paramètres du restaurant et calcul d'une addition (frais de table / service, TVA).
// Même calcul que server/settings.js. Partagé par les trois interfaces.

export type Currency = "EUR" | "USD" | "DZD";

/** Devises proposées : euro (par défaut), dollar américain, dinar algérien */
export const CURRENCY_CODES: Currency[] = ["EUR", "USD", "DZD"];

export interface RestaurantSettings {
  restaurant_name: string;
  restaurant_address: string;
  restaurant_phone: string;
  receipt_footer: string;
  /** Devise des prix, des factures et des rapports de ce restaurant */
  currency: Currency;
  /** Fuseau horaire du restaurant (ex. "Europe/Paris") */
  timezone: string;
  /** Code que les caissiers saisissent pour se connecter (présent seulement pour le personnel) */
  restaurant_code?: string | null;
  tax_enabled: boolean;
  tax_rate: number;
  tax_mode: "included" | "added";
  service_type: "none" | "fixed" | "percent";
  service_value: number;
  /** Chez un client : TVA propre à sa table (déjà appliquée à tax_enabled / tax_rate) ; null = taux du restaurant */
  table_tax_rate?: number | null;
}

export interface BillBreakdown {
  subtotal: number;
  service: number;
  serviceLabel: string | null;
  tax: number;
  taxRate: number;
  taxMode: "included" | "added" | null;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Addition à partir du sous-total des plats. `tableTaxRate` : TVA propre à la table (0 à 100, null = taux du restaurant) ;
 * le mode (comprise / ajoutée) reste celui du restaurant. Chez un client, les paramètres reçus portent déjà le taux de sa table.
 */
export function computeBill(subtotal: number, settings: RestaurantSettings | null, tableTaxRate: number | null = null): BillBreakdown {
  if (!settings) return { subtotal, service: 0, serviceLabel: null, tax: 0, taxRate: 0, taxMode: null, total: subtotal };
  let service = 0;
  let serviceLabel: string | null = null;
  if (settings.service_type === "fixed" && settings.service_value > 0) {
    service = settings.service_value;
    serviceLabel = "Table fee";
  } else if (settings.service_type === "percent" && settings.service_value > 0) {
    service = (subtotal * settings.service_value) / 100;
    serviceLabel = `Service (${settings.service_value} %)`;
  }
  const base = subtotal + service;
  const ownRate = tableTaxRate === null || tableTaxRate === undefined ? null : Number(tableTaxRate);
  const taxEnabled = ownRate !== null ? ownRate > 0 : Boolean(settings.tax_enabled && settings.tax_rate > 0);
  const taxRate = ownRate !== null ? ownRate : settings.tax_rate;
  let tax = 0;
  let total = base;
  if (taxEnabled) {
    if (settings.tax_mode === "added") {
      tax = (base * taxRate) / 100;
      total = base + tax;
    } else {
      tax = base - base / (1 + taxRate / 100); // part de TVA comprise dans les prix
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

/** Paramètres du restaurant. Le personnel les lit avec son jeton, le client avec sa session de table (ajoutés automatiquement). */
export async function fetchSettings(): Promise<RestaurantSettings | null> {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) return null;
    return (await response.json()).data;
  } catch {
    return null;
  }
}

/**
 * Paramètres du restaurant, rechargés quand la fenêtre redevient active et à chaque changement fait par l'admin.
 * `refreshKey` : changer sa valeur force un rechargement (ex. événement Socket.IO "settings-updated").
 */
export function useRestaurantSettings(refreshKey: unknown = 0) {
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  useEffect(() => {
    const load = () => fetchSettings().then((s) => s && setSettings(s));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [refreshKey]);
  return settings;
}

/** Lignes de détail à afficher sous les articles (sous-total, frais, TVA), traduites ; vide si rien à ajouter */
export function breakdownLines(bill: BillBreakdown, t: Translate): { label: string; amount: number; muted?: boolean }[] {
  const lines: { label: string; amount: number; muted?: boolean }[] = [];
  if (bill.service > 0 || bill.taxMode === "added") lines.push({ label: t("bill.subtotal"), amount: bill.subtotal });
  if (bill.service > 0 && bill.serviceLabel) lines.push({ label: serviceLabel(bill.serviceLabel, t), amount: bill.service });
  if (bill.taxMode === "added") lines.push({ label: t("bill.vat", { rate: bill.taxRate }), amount: bill.tax });
  return lines;
}

/** Le serveur garde le libellé des frais en anglais sur la facture ("Table fee", "Service (10 %)") : on le traduit à l'affichage */
export function serviceLabel(label: string, t: Translate): string {
  if (label.startsWith("Table fee")) return t("bill.tableFee");
  const percent = label.match(/\(([\d.,]+)\s*%\)/);
  if (label.startsWith("Service")) return percent ? t("bill.service", { percent: percent[1] }) : t("bill.service", { percent: "" });
  return label;
}

/** Mention sous le total pour une TVA comprise dans les prix. `format` met le montant en devise. */
export const includedTaxNote = (bill: BillBreakdown, t: Translate, format: (amount: number) => string) =>
  bill.taxMode === "included" && bill.tax > 0 ? t("bill.vatIncluded", { rate: bill.taxRate, amount: format(bill.tax) }) : null;

// ---- Addition d'une visite telle que le serveur la renvoie au client (GET /api/sessions/:token/bill) ----

export interface SessionBill {
  restaurant: { name: string; address: string | null; phone: string | null; footer: string | null };
  currency: Currency;
  timezone: string;
  table: string;
  /** open : visite en cours (addition provisoire) | paid : table encaissée (facture) */
  status: "open" | "paid";
  invoiceNumber: string | null;
  /** UTC "AAAA-MM-JJ HH:MM:SS" */
  date: string;
  lines: { name: string; price: number; quantity: number }[];
  breakdown: BillBreakdown;
  total: number;
}

export async function fetchSessionBill(sessionToken: string): Promise<SessionBill | null> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionToken)}/bill`);
    if (!response.ok) return null;
    return (await response.json()).data;
  } catch {
    return null;
  }
}
