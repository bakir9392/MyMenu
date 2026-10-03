import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useI18n } from "../../shared/i18n";

const NotFound = () => {
  const location = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4 text-foreground">404</h1>
        <p className="text-xl font-medium mb-2 text-foreground">{t("admin.notFound.title")}</p>
        <p className="text-muted-foreground mb-4">{t("admin.notFound.text")}</p>
        <a href="/admin/" className="text-primary hover:text-primary/80 underline">
          {t("admin.notFound.back")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
