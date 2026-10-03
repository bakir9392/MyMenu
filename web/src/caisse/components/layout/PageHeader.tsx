import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher, useI18n } from "../../../shared/i18n";
import { useCashier } from "@/lib/auth";
import { useRestaurant } from "@/hooks/useRestaurant";

/** Bandeau des écrans secondaires : retour au tableau de bord, restaurant, caissier, langue, déconnexion */
export const PageHeader = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { session, logout } = useCashier();
  const { name } = useRestaurant();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" onClick={() => navigate("/")} className="flex items-center gap-2">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t("caisse.nav.back")}
      </Button>
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <LanguageSwitcher />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{name}</span>
          {" · "}
          {t("caisse.nav.loggedInAs")} <span className="font-medium text-foreground">{session.user.name}</span>
        </div>
        <Button variant="outline" onClick={logout}>
          {t("caisse.layout.logout")}
        </Button>
      </div>
    </div>
  );
};
