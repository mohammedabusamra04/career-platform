import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

/**
 * Builds the inline keyboard for the /settings dashboard (DeployMe identity).
 * Provides controls to edit tech stack/specializations, target region, or switch language.
 */
export function buildSettingsKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const editSpecsLabel = lang === 'ar' ? 'تعديل الـ Stack 🛠️' : 'Edit Stack 🛠️';
  const editRegionLabel = lang === 'ar' ? 'تعديل نطاق السوق 🌍' : 'Edit Market Scope 🌍';
  const editExpLabel = lang === 'ar' ? 'تحديد مستوى الخبرة 📊' : 'Experience Level 📊';
  const switchLangLabel = lang === 'ar' ? '🌐 English' : '🌐 العربية';

  keyboard.text(editSpecsLabel, 'settings_edit_specs').row();
  keyboard.text(editRegionLabel, 'settings_edit_region').row();
  keyboard.text(editExpLabel, 'settings_edit_experience').row();
  keyboard.text(switchLangLabel, 'settings_toggle_lang');

  return keyboard;
}