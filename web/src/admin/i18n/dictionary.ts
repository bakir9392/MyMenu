import { mergeDictionaries } from "../../shared/i18n";
import { COMMON_DICTIONARY } from "../../shared/i18n/common";
import { DISH_FORM_DICTIONARY } from "../../shared/i18n/menu-form";
import { ADMIN_CORE_DICTIONARY } from "./core";
import { ADMIN_REPORTS_DICTIONARY } from "./reports";

export const ADMIN_DICTIONARY = mergeDictionaries(COMMON_DICTIONARY, DISH_FORM_DICTIONARY, ADMIN_CORE_DICTIONARY, ADMIN_REPORTS_DICTIONARY);
