import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

/**
 * Builds the inline keyboard for the /settings dashboard.
 * Provides controls to edit specializations, edit target region, or switch language.
 */
export function buildSettingsKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const editSpecsLabel = lang === 'ar' ? 'تعديل التخصصات 🛠️' : 'Edit Specializations 🛠️';
  const editRegionLabel = lang === 'ar' ? 'تعديل المنطقة 🌍' : 'Edit Target Region 🌍';
  const switchLangLabel = lang === 'ar' ? 'English 🇺🇸' : 'العربية 🇸🇦';

  keyboard.text(editSpecsLabel, 'settings_edit_specs').row();
  keyboard.text(editRegionLabel, 'settings_edit_region').row();
  keyboard.text(switchLangLabel, 'settings_toggle_lang');

  return keyboard;
}
