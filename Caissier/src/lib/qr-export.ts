import QRCode from "qrcode";
import JSZip from "jszip";

// Correction d'erreur maximale (H, ~30 %) : le QR reste lisible avec un logo au centre,
// une rayure ou un reflet (autocollant sur verre, plastifié...).
const QR_OPTIONS = { errorCorrectionLevel: "H" as const };

export const qrPngDataUrl = (link: string, width = 320, margin = 1) =>
  QRCode.toDataURL(link, { ...QR_OPTIONS, width, margin });

/** SVG vectoriel : agrandissable sans perte, à donner à un graphiste ou un imprimeur */
export const qrSvg = (link: string) => QRCode.toString(link, { ...QR_OPTIONS, type: "svg", margin: 4 });

const safeName = (table: string) => `table-${table.replace(/[^\w-]+/g, "_")}`;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

/** PNG haute définition (2048 px ≈ 17 cm à 300 dpi) */
export async function downloadPng(table: string, link: string) {
  downloadBlob(await dataUrlToBlob(await qrPngDataUrl(link, 2048, 4)), `${safeName(table)}.png`);
}

export async function downloadSvg(table: string, link: string) {
  downloadBlob(new Blob([await qrSvg(link)], { type: "image/svg+xml" }), `${safeName(table)}.svg`);
}

/** Archive ZIP de toutes les tables, en PNG haute définition et en SVG */
export async function downloadAllZip(tables: { number: string; link: string }[]) {
  const zip = new JSZip();
  for (const { number, link } of tables) {
    zip.file(`png/${safeName(number)}.png`, await dataUrlToBlob(await qrPngDataUrl(link, 2048, 4)));
    zip.file(`svg/${safeName(number)}.svg`, await qrSvg(link));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), "qr-codes-tables.zip");
}

export type PrintFormat = "sticker" | "medium" | "large" | "tent";

export const PRINT_FORMATS: Record<PrintFormat, { qrCm: number; fr: string; ar: string }> = {
  sticker: { qrCm: 4, fr: "Petit – autocollant / verre (4 cm)", ar: "صغير – ملصق / زجاج (4 سم)" },
  medium: { qrCm: 6, fr: "Moyen – support de table (6 cm)", ar: "متوسط – حامل طاولة (6 سم)" },
  large: { qrCm: 10, fr: "Grand – affiche (10 cm)", ar: "كبير – ملصق حائط (10 سم)" },
  tent: { qrCm: 7, fr: "Chevalet de table plié (A6)", ar: "بطاقة طاولة مطوية (A6)" },
};

export interface PrintOptions {
  format: PrintFormat;
  showNumber: boolean;
  showHint: boolean;
  title: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** Ouvre une feuille d'impression aux dimensions réelles (en cm) */
export async function printQrSheet(tables: { number: string; link: string }[], options: PrintOptions) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const { qrCm } = PRINT_FORMATS[options.format];
  const isTent = options.format === "tent";

  const cards = await Promise.all(
    tables.map(async ({ number, link }) => {
      const svg = await qrSvg(link);
      const face = `
        <div class="face">
          ${options.title ? `<div class="title">${escapeHtml(options.title)}</div>` : ""}
          <div class="qr">${svg}</div>
          ${options.showNumber ? `<div class="number">Table ${escapeHtml(number)}</div>` : ""}
          ${options.showHint ? `<div class="hint">Scannez pour commander · امسح للطلب</div>` : ""}
        </div>`;
      // Chevalet : deux faces identiques, la seconde retournée pour être lisible une fois plié
      return isTent ? `<div class="card tent">${face}<div class="fold"></div><div class="flipped">${face}</div></div>` : `<div class="card">${face}</div>`;
    })
  );

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR codes des tables</title><style>
    @page { margin: 1cm; }
    body { font-family: Arial, sans-serif; margin: 0; }
    .sheet { display: flex; flex-wrap: wrap; gap: 0.5cm; }
    .card { border: 1px dashed #bbb; border-radius: 0.3cm; padding: 0.4cm; text-align: center; break-inside: avoid; }
    .qr svg { width: ${qrCm}cm; height: ${qrCm}cm; display: block; margin: 0 auto; }
    .title { font-weight: bold; font-size: ${Math.max(10, qrCm * 2.4)}pt; margin-bottom: 0.15cm; }
    .number { font-weight: bold; font-size: ${Math.max(9, qrCm * 2.6)}pt; margin-top: 0.15cm; }
    .hint { color: #444; font-size: ${Math.max(6, qrCm * 1.4)}pt; margin-top: 0.1cm; }
    .tent { width: 10.5cm; height: 14.8cm; padding: 0; display: flex; flex-direction: column; }
    .tent .face, .tent .flipped { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .tent .flipped { transform: rotate(180deg); }
    .tent .fold { border-top: 1px dashed #999; }
    @media print { .card { border-color: #ddd; } }
  </style></head><body><div class="sheet">${cards.join("")}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 200);</script></body></html>`);
  win.document.close();
  return true;
}
