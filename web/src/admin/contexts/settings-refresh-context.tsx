import { createContext, useContext } from "react";

/** Change à chaque événement temps réel "settings-updated" : les écrans rechargent alors les paramètres du restaurant */
export const SettingsRefreshContext = createContext(0);
export const useSettingsRefreshKey = () => useContext(SettingsRefreshContext);
