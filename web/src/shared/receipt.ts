import { BillBreakdown, breakdownLines, Currency, includedTaxNote } from "./bill";
import type { Lang, MoneyFormatter, Translate } from "./i18n";

// Tickets (factures, additions, récapitulatifs) : impression sur imprimante de tickets thermique (80 mm ou 58 mm)
// ou imprimante A4, et enregistrement en image pour le client. Textes traduits, montants dans la devise du restaurant,
// mise en page de droite à gauche en arabe. Partagé par les trois interfaces.

export type PaperFormat = "80mm" | "58mm" | "a4";

export const PAPER_FORMATS: PaperFormat[] = ["80mm", "58mm", "a4"];
/** Clés de traduction du nom de chaque format de papier */
export const PAPER_LABEL_KEYS: Record<PaperFormat, string> = {
  "80mm": "receipt.paper80",
  "58mm": "receipt.paper58",
  a4: "receipt.paperA4",
};

const PAPER_KEY = "receipt-paper-format";

/** Format choisi sur cet appareil (chaque poste a sa propre imprimante) ; 80 mm par défaut, le plus courant */
export function getPaperFormat(): PaperFormat {
  try {
    const value = localStorage.getItem(PAPER_KEY);
    if (value === "80mm" || value === "58mm" || value === "a4") return value;
  } catch {
    // stockage indisponible
  }
  return "80mm";
}

export function setPaperFormat(format: PaperFormat) {
  try {
    localStorage.setItem(PAPER_KEY, format);
  } catch {
    // stockage indisponible
  }
}

/** Ce que le ticket a besoin de la langue : les fonctions de useI18n() */
export interface ReceiptI18n {
  t: Translate;
  money: MoneyFormatter;
  lang: Lang;
  dir: "ltr" | "rtl";
  formatDateTime: (value: Date | string, timeZone?: string | null) => string;
}

export interface ReceiptLine {
  name: string;
  price: number;
  quantity: number;
}

export interface Receipt {
  restaurantName: string;
  address?: string | null;
  phone?: string | null;
  /** Numéro de facture ; absent pour une addition pas encore payée */
  number?: string | null;
  tableNumber: string;
  date: Date;
  cashier?: string | null;
  lines: ReceiptLine[];
  total: number;
  currency: Currency;
  /** Fuseau du restaurant pour l'heure affichée */
  timeZone?: string | null;
  /** Détail : sous-total, frais de table / service, TVA (paramètres du restaurant) */
  breakdown?: BillBreakdown | null;
  /** Message en bas du ticket (paramètres du restaurant) */
  footer?: string | null;
}

// Largeur imprimable et taille de texte par format (papier 80 mm ≈ 72 mm imprimables, 58 mm ≈ 48 mm).
// Marges à 0 pour les rouleaux : la longueur du ticket suit son contenu, le pilote de l'imprimante coupe en fin de page.
const LAYOUT: Record<PaperFormat, { width: string; font: number; page: string }> = {
  "80mm": { width: "72mm", font: 12, page: "margin: 0;" },
  "58mm": { width: "48mm", font: 10.5, page: "margin: 0;" },
  a4: { width: "100mm", font: 13, page: "size: A4; margin: 15mm;" },
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Styles communs aux tickets (facture, addition, récapitulatif)
function ticketStyles(format: PaperFormat) {
  const { width, font, page } = LAYOUT[format];
  return `
    /* Marges à 0 : le navigateur n'ajoute pas ses en-têtes / pieds de page (date, adresse) sur le rouleau */
    @page { ${page} }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      width: ${width}; margin: 0 auto;
      font-family: "Courier New", Consolas, "Noto Sans Arabic", Tahoma, monospace; font-size: ${font}px; line-height: 1.35;
      color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .ticket { padding: 3mm 0 6mm; }
    /* Un ticket par page : l'imprimante coupe le papier entre deux factures */
    .ticket + .ticket { break-before: page; page-break-before: always; }
    .center { text-align: center; }
    .shop { font-size: ${font * 1.45}px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
    .small { font-size: ${font * 0.9}px; }
    .title { font-weight: 700; margin-top: 2mm; }
    .section { font-weight: 700; margin: 1mm 0; text-transform: uppercase; }
    .sep { border-top: 1px dashed #000; margin: 2.5mm 0; }
    .row { display: flex; justify-content: space-between; gap: 2mm; }
    .row span:last-child { white-space: nowrap; }
    .item { margin-bottom: 1.5mm; }
    .name { font-weight: 700; word-break: break-word; }
    .total { font-size: ${font * 1.4}px; font-weight: 700; }
    .note { text-align: end; }
    .thanks { margin-top: 3mm; font-weight: 700; }`;
}

const shopHeader = (shop: { restaurantName: string; address?: string | null; phone?: string | null }, i18n: ReceiptI18n) => `
    <div class="center shop">${escapeHtml(shop.restaurantName)}</div>
    ${shop.address ? `<div class="center small">${escapeHtml(shop.address)}</div>` : ""}
    ${shop.phone ? `<div class="center small">${escapeHtml(i18n.t("receipt.phone", { phone: shop.phone }))}</div>` : ""}`;

function receiptBody(receipt: Receipt, i18n: ReceiptI18n) {
  const { t, money } = i18n;
  const m = (amount: number) => money(amount, receipt.currency);
  const title = receipt.number ? t("receipt.invoice", { number: receipt.number }) : t("receipt.billUnpaid");
  const items = receipt.lines
    .map((line) => `
      <div class="item">
        <div class="name">${escapeHtml(line.name)}</div>
        <div class="row"><span>${line.quantity} x ${escapeHtml(m(line.price))}</span><span>${escapeHtml(m(line.price * line.quantity))}</span></div>
      </div>`)
    .join("");
  const count = receipt.lines.reduce((sum, line) => sum + line.quantity, 0);
  const note = receipt.breakdown ? includedTaxNote(receipt.breakdown, t, m) : null;
  return `<div class="ticket">
    ${shopHeader(receipt, i18n)}
    <div class="center title">${escapeHtml(title)}</div>
    <div class="sep"></div>
    <div class="row"><span>${escapeHtml(t("receipt.table"))}</span><span>${escapeHtml(receipt.tableNumber)}</span></div>
    <div class="row"><span>${escapeHtml(t("receipt.date"))}</span><span>${escapeHtml(i18n.formatDateTime(receipt.date, receipt.timeZone))}</span></div>
    ${receipt.cashier ? `<div class="row"><span>${escapeHtml(t("receipt.cashier"))}</span><span>${escapeHtml(receipt.cashier)}</span></div>` : ""}
    <div class="sep"></div>
    ${items}
    <div class="sep"></div>
    <div class="row small"><span>${escapeHtml(t("receipt.items"))}</span><span>${count}</span></div>
    ${receipt.breakdown ? breakdownLines(receipt.breakdown, t).map((line) => `<div class="row"><span>${escapeHtml(line.label)}</span><span>${escapeHtml(m(line.amount))}</span></div>`).join("") : ""}
    <div class="row total"><span>${escapeHtml(t("receipt.total"))}</span><span>${escapeHtml(m(receipt.total))}</span></div>
    ${note ? `<div class="small note">${escapeHtml(note)}</div>` : ""}
    <div class="sep"></div>
    <div class="center thanks">${escapeHtml(receipt.footer || t("receipt.thanks"))}</div>
  </div>`;
}

const pageHtml = (format: PaperFormat, title: string, bodies: string[], i18n: ReceiptI18n) =>
  `<!doctype html><html lang="${i18n.lang}" dir="${i18n.dir}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${ticketStyles(format)}</style></head><body>${bodies.join("")}</body></html>`;

/** HTML d'un ticket (aperçu ou impression) */
export function receiptHtml(receipt: Receipt, format: PaperFormat, i18n: ReceiptI18n) {
  return pageHtml(format, receipt.number ?? i18n.t("receipt.bill"), [receiptBody(receipt, i18n)], i18n);
}

/** Récapitulatif d'une période (ticket de clôture) */
export interface PeriodSummary {
  restaurantName: string;
  address?: string | null;
  phone?: string | null;
  periodLabel: string;
  currency: Currency;
  totals: { invoices: number; revenue: number; average_ticket: number; tax?: number; service?: number };
  byDay: { day: string; invoices: number; revenue: number }[];
  byCashier: { name: string; invoices: number; revenue: number }[];
  dishes: { name: string; quantity: number; revenue: number }[];
}

export function summaryHtml(summary: PeriodSummary, format: PaperFormat, i18n: ReceiptI18n) {
  const { t } = i18n;
  const m = (amount: number) => i18n.money(amount, summary.currency);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(i18n.lang === "ar" ? "ar-u-nu-latn" : i18n.lang, { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T12:00:00`));
  const byDay = summary.byDay.length > 1
    ? `<div class="sep"></div><div class="section">${escapeHtml(t("receipt.byDay"))}</div>` +
      summary.byDay.map((d) => `<div class="row"><span>${escapeHtml(day(d.day))} (${d.invoices})</span><span>${escapeHtml(m(d.revenue))}</span></div>`).join("")
    : "";
  const byCashier = summary.byCashier.length
    ? `<div class="sep"></div><div class="section">${escapeHtml(t("receipt.byCashier"))}</div>` +
      summary.byCashier.map((c) => `<div class="row"><span>${escapeHtml(c.name === "Not recorded" ? t("receipt.notRecorded") : c.name)} (${c.invoices})</span><span>${escapeHtml(m(c.revenue))}</span></div>`).join("")
    : "";
  const dishes = summary.dishes.length
    ? `<div class="sep"></div><div class="section">${escapeHtml(t("receipt.dishesSold"))}</div>` +
      summary.dishes.map((d) => `<div class="item"><div class="name">${escapeHtml(d.name)}</div><div class="row"><span>x ${d.quantity}</span><span>${escapeHtml(m(d.revenue))}</span></div></div>`).join("")
    : "";
  const body = `<div class="ticket">
    ${shopHeader(summary, i18n)}
    <div class="center title">${escapeHtml(t("receipt.summary"))}</div>
    <div class="center small">${escapeHtml(summary.periodLabel)}</div>
    <div class="center small">${escapeHtml(t("receipt.printedOn", { date: i18n.formatDateTime(new Date()) }))}</div>
    <div class="sep"></div>
    <div class="row"><span>${escapeHtml(t("receipt.invoices"))}</span><span>${summary.totals.invoices}</span></div>
    <div class="row"><span>${escapeHtml(t("receipt.averageTicket"))}</span><span>${escapeHtml(m(summary.totals.average_ticket))}</span></div>
    ${summary.totals.service ? `<div class="row"><span>${escapeHtml(t("receipt.inclFees"))}</span><span>${escapeHtml(m(summary.totals.service))}</span></div>` : ""}
    ${summary.totals.tax ? `<div class="row"><span>${escapeHtml(t("receipt.inclVat"))}</span><span>${escapeHtml(m(summary.totals.tax))}</span></div>` : ""}
    <div class="row total"><span>${escapeHtml(t("receipt.total"))}</span><span>${escapeHtml(m(summary.totals.revenue))}</span></div>
    ${byDay}
    ${byCashier}
    ${dishes}
  </div>`;
  return pageHtml(format, t("receipt.summary"), [body], i18n);
}

/**
 * Imprime un document via un cadre caché (pas de nouvelle fenêtre, pas de blocage des pop-ups).
 * La boîte d'impression du navigateur s'ouvre : choisir l'imprimante de tickets (ou « Enregistrer au format PDF »).
 */
function printHtml(html: string): boolean {
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => setTimeout(() => frame.remove(), 500);
    win.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(cleanup, 60000); // au cas où "afterprint" ne serait pas déclenché
    }, 250);
    return true;
  } catch {
    return false;
  }
}

export function printReceipt(receipt: Receipt, i18n: ReceiptI18n, format: PaperFormat = getPaperFormat()): boolean {
  return printHtml(receiptHtml(receipt, format, i18n));
}

/** Plusieurs factures en une seule impression (un ticket par facture, coupe entre chaque) */
export function printReceipts(receipts: Receipt[], i18n: ReceiptI18n, format: PaperFormat = getPaperFormat()): boolean {
  if (receipts.length === 0) return false;
  return printHtml(pageHtml(format, i18n.t("receipt.invoicesCount", { count: receipts.length }), receipts.map((r) => receiptBody(r, i18n)), i18n));
}

export function printSummary(summary: PeriodSummary, i18n: ReceiptI18n, format: PaperFormat = getPaperFormat()): boolean {
  return printHtml(summaryHtml(summary, format, i18n));
}

// ---- Image du ticket (pour que le client l'enregistre sur son téléphone) ----

interface Row {
  kind: "center" | "row" | "sep" | "gap";
  left?: string;
  right?: string;
  bold?: boolean;
  size?: number;
}

function receiptRows(receipt: Receipt, i18n: ReceiptI18n): Row[] {
  const { t } = i18n;
  const m = (amount: number) => i18n.money(amount, receipt.currency);
  const rows: Row[] = [{ kind: "center", left: receipt.restaurantName.toUpperCase(), bold: true, size: 20 }];
  if (receipt.address) rows.push({ kind: "center", left: receipt.address, size: 12 });
  if (receipt.phone) rows.push({ kind: "center", left: t("receipt.phone", { phone: receipt.phone }), size: 12 });
  rows.push({ kind: "gap" });
  rows.push({ kind: "center", left: receipt.number ? t("receipt.invoice", { number: receipt.number }) : t("receipt.billUnpaid"), bold: true, size: 15 });
  rows.push({ kind: "sep" });
  rows.push({ kind: "row", left: t("receipt.table"), right: receipt.tableNumber });
  rows.push({ kind: "row", left: t("receipt.date"), right: i18n.formatDateTime(receipt.date, receipt.timeZone) });
  if (receipt.cashier) rows.push({ kind: "row", left: t("receipt.cashier"), right: receipt.cashier });
  rows.push({ kind: "sep" });
  for (const line of receipt.lines) {
    rows.push({ kind: "center", left: line.name, bold: true, size: 14 });
    rows.push({ kind: "row", left: `${line.quantity} x ${m(line.price)}`, right: m(line.price * line.quantity) });
  }
  rows.push({ kind: "sep" });
  if (receipt.breakdown) for (const line of breakdownLines(receipt.breakdown, t)) rows.push({ kind: "row", left: line.label, right: m(line.amount) });
  rows.push({ kind: "row", left: t("receipt.total"), right: m(receipt.total), bold: true, size: 18 });
  const note = receipt.breakdown ? includedTaxNote(receipt.breakdown, t, m) : null;
  if (note) rows.push({ kind: "row", left: "", right: note, size: 11 });
  rows.push({ kind: "sep" });
  rows.push({ kind: "center", left: receipt.footer || t("receipt.thanks"), bold: true, size: 14 });
  return rows;
}

/** Ticket dessiné sur un canvas, rendu en PNG (texte net, lisible sur téléphone, fonctionne partout) */
export async function receiptToPng(receipt: Receipt, i18n: ReceiptI18n): Promise<Blob> {
  const width = 380;
  const pad = 20;
  const scale = 2;
  const rtl = i18n.dir === "rtl";
  const family = '"Courier New", Consolas, "Noto Sans Arabic", Tahoma, monospace';
  const measure = document.createElement("canvas").getContext("2d")!;

  const fontFor = (row: Row) => `${row.bold ? "700" : "400"} ${row.size ?? 13}px ${family}`;
  const wrap = (text: string, row: Row, maxWidth: number) => {
    measure.font = fontFor(row);
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  // Mise en page : chaque ligne devient une ou plusieurs lignes de texte
  type Drawn = { y: number; row: Row; text: string; rightText?: string };
  const drawn: Drawn[] = [];
  let y = pad;
  const inner = width - pad * 2;
  for (const row of receiptRows(receipt, i18n)) {
    const size = row.size ?? 13;
    const lineHeight = Math.round(size * 1.45);
    if (row.kind === "gap") {
      y += 6;
    } else if (row.kind === "sep") {
      drawn.push({ y: y + 6, row, text: "" });
      y += 14;
    } else if (row.kind === "center") {
      for (const text of wrap(row.left ?? "", row, inner)) {
        drawn.push({ y: y + size, row, text });
        y += lineHeight;
      }
    } else {
      measure.font = fontFor(row);
      const rightWidth = measure.measureText(row.right ?? "").width;
      const leftLines = wrap(row.left ?? "", row, Math.max(60, inner - rightWidth - 10));
      leftLines.forEach((text, index) => {
        drawn.push({ y: y + size, row, text, rightText: index === 0 ? row.right : undefined });
        y += lineHeight;
      });
    }
  }
  const height = y + pad;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.direction = rtl ? "rtl" : "ltr";

  for (const item of drawn) {
    ctx.font = fontFor(item.row);
    if (item.row.kind === "sep") {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      ctx.moveTo(pad, item.y);
      ctx.lineTo(width - pad, item.y);
      ctx.stroke();
      ctx.restore();
    } else if (item.row.kind === "center") {
      ctx.textAlign = "center";
      ctx.fillText(item.text, width / 2, item.y);
    } else {
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(item.text, rtl ? width - pad : pad, item.y);
      if (item.rightText) {
        ctx.textAlign = rtl ? "left" : "right";
        ctx.fillText(item.rightText, rtl ? pad : width - pad, item.y);
      }
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))), "image/png");
  });
}

/**
 * Enregistre le ticket en image : feuille de partage du téléphone (Photos, Fichiers...) quand elle existe,
 * sinon téléchargement du PNG. Retourne "shared" | "downloaded" | "cancelled".
 */
export async function saveReceiptImage(receipt: Receipt, i18n: ReceiptI18n, fileName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await receiptToPng(receipt, i18n);
  const file = new File([blob], `${fileName}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return "cancelled";
      // le partage a échoué : on télécharge à la place
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
