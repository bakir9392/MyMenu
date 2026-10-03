import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  onBack: () => void;
}

/** Barre du haut des pages secondaires (panier, commandes, addition, réclamation) : retour, titre, choix de la langue */
const PageHeader = ({ title, subtitle, onBack }: PageHeaderProps) => {
  const { t } = useI18n();
  return (
    <div className="bg-primary text-white p-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="text-white hover:bg-white/10 shrink-0" aria-label={t("client.common.back")}>
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{title}</h1>
          {subtitle && <p className="text-primary-foreground/80">{subtitle}</p>}
        </div>
        <LanguageSwitcher tone="light" className="shrink-0" />
      </div>
    </div>
  );
};

export default PageHeader;
