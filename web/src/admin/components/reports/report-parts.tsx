import { ReactNode, useMemo } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "../../../shared/i18n";

// Éléments communs aux rapports et au tableau de bord : tuiles, comparaison, dates, styles de graphique.

/** Couleurs des séries (la couleur principale est celle du thème) */
export const PRIMARY_COLOR = "hsl(var(--primary))";
export const ORDERS_COLOR = "#3b82f6";
export const VISITS_COLOR = "#8b5cf6";

export const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};

/** Style de l'infobulle ; le texte suit le sens de la langue même si le graphique reste de gauche à droite */
export function useTooltipStyle() {
  const { isRtl } = useI18n();
  return useMemo(() => ({ ...tooltipStyle, direction: isRtl ? ("rtl" as const) : ("ltr" as const) }), [isRtl]);
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-JJ" -> Date à midi UTC : formatée en UTC, le jour affiché ne bouge jamais, quel que soit le fuseau du navigateur */
export const ymdToDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** Dates calendaires (sans heure) formatées avec les noms de la langue active, via Intl */
export function useDateTools() {
  const { formatDate } = useI18n();
  return useMemo(() => {
    const day = (ymd: string, options: Intl.DateTimeFormatOptions) => formatDate(ymdToDate(ymd), "UTC", options);
    const month = (year: number, monthNumber: number, options: Intl.DateTimeFormatOptions) =>
      formatDate(new Date(Date.UTC(year, monthNumber - 1, 15, 12)), "UTC", options);
    /** index 0 = lundi ... 6 = dimanche */
    const weekday = (index: number, style: "short" | "long" = "short") =>
      formatDate(new Date(Date.UTC(2024, 0, 1 + index, 12)), "UTC", { weekday: style });
    return { day, month, weekday };
  }, [formatDate]);
}

/** Chiffre arrondi pour comparaison : variation en % entre la période affichée et la précédente */
export function Delta({
  current,
  previous,
  compareLabel,
  previousText,
}: {
  current: number;
  previous: number;
  compareLabel: string;
  /** Valeur de la période précédente déjà formatée */
  previousText?: string;
}) {
  const { t, formatNumber } = useI18n();
  let tone: "up" | "down" | "flat";
  let text: string;
  if (!previous) {
    tone = current > 0 ? "up" : "flat";
    text = current > 0 ? t("reports.compare.new") : t("reports.compare.same");
  } else {
    const ratio = (current - previous) / previous;
    tone = Math.abs(ratio) < 0.0005 ? "flat" : ratio > 0 ? "up" : "down";
    text =
      tone === "flat"
        ? t("reports.compare.same")
        : formatNumber(ratio, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
  }
  const Icon = tone === "up" ? ArrowUp : tone === "down" ? ArrowDown : Minus;
  const color = tone === "up" ? "text-green-600" : tone === "down" ? "text-red-600" : "text-muted-foreground";
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span className={`inline-flex items-center gap-0.5 font-medium ${color}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span dir="ltr">{text}</span>
      </span>
      <span>{compareLabel}</span>
      {previousText !== undefined && <span>({t("reports.compare.was", { value: previousText })})</span>}
    </p>
  );
}

export function KpiTile({
  title,
  value,
  hint,
  icon: Icon,
  footer,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {footer}
      </CardContent>
    </Card>
  );
}

/** Les graphiques restent de gauche à droite même dans une page arabe : axes et barres ne se retrouvent pas inversés */
export function ChartBox({ children }: { children: ReactNode }) {
  return <div dir="ltr">{children}</div>;
}
