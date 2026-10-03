import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

const NotFound = () => {
  const location = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="absolute top-3 end-3">
        <LanguageSwitcher />
      </div>
      <div className="text-center px-4">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-4">{t("client.notFound.title")}</p>
        <a href="/" className="text-blue-500 hover:text-blue-700 underline">
          {t("client.notFound.home")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
