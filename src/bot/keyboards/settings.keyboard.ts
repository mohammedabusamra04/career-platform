import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

/**
 * Builds the inline keyboard for the /settings dashboard (DeployMe identity).
 * Provides controls to edit tech stack/specializations, target region, or switch language.
 */
export function buildSettingsKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const switchLangLabel = lang === 'ar' ? '🌐 English' : '🌐 العربية';
  const editSpecsLabel = lang === 'ar' ? 'تعديل الـ Stack 🛠️' : 'Edit Stack 🛠️';
  const editRegionLabel = lang === 'ar' ? 'تعديل نطاق السوق 🌍' : 'Edit Market Scope 🌍';
  const editExpLabel = lang === 'ar' ? 'تحديد مستوى الخبرة 📊' : 'Experience Level 📊';

  // Language switch at the very top for instant visibility
  keyboard.text(switchLangLabel, 'settings_toggle_lang').row();
  keyboard.text(editSpecsLabel, 'settings_edit_specs').row();
  keyboard.text(editRegionLabel, 'settings_edit_region').row();
  keyboard.text(editExpLabel, 'settings_edit_experience');

  return keyboard;
}