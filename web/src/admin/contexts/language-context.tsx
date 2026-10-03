import { ReactNode } from "react";
import { Lang, useI18n } from "../../shared/i18n";

// Couche de compatibilité : l'ancien contexte de langue de l'admin repose maintenant sur le socle commun (useI18n).
// Les nouveaux composants utilisent directement useI18n() de ../../shared/i18n.

export type Language = Lang;

/** Plus nécessaire : <I18nProvider> est posé dans main.tsx. Gardé pour les anciens imports. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useLanguage() {
  const i18n = useI18n();
  return { ...i18n, language: i18n.lang, setLanguage: i18n.setLang };
}
