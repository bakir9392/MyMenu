import { useCallback, useState } from "react";
import { Printer } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "../../../shared/i18n";
import { getPaperFormat, PAPER_FORMATS, PAPER_LABEL_KEYS, PaperFormat, setPaperFormat } from "../../../shared/receipt";

/** Format de papier de l'imprimante de ce poste, mémorisé sur l'appareil */
export function usePaperFormat(): [PaperFormat, (format: PaperFormat) => void] {
  const [paper, setPaper] = useState<PaperFormat>(getPaperFormat);
  const update = useCallback((format: PaperFormat) => {
    setPaper(format);
    setPaperFormat(format);
  }, []);
  return [paper, update];
}

interface PaperFormatSelectProps {
  value: PaperFormat;
  onChange: (format: PaperFormat) => void;
  className?: string;
}

export function PaperFormatSelect({ value, onChange, className = "w-56" }: PaperFormatSelectProps) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as PaperFormat)}>
      <SelectTrigger className={className} aria-label={t("caisse.print.paper")} title={t("caisse.print.paper")}>
        <Printer className="w-4 h-4 me-2 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAPER_FORMATS.map((format) => (
          <SelectItem key={format} value={format}>{t(PAPER_LABEL_KEYS[format])}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
