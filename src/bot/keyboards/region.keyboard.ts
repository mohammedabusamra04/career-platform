import { InlineKeyboard } from 'grammy';
import { RegionPreference } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';

export interface RegionOption {
  key: RegionPreference;
  labelAr: string;
  labelEn: string;
}

export const REGION_OPTIONS: RegionOption[] = [
  {
    key: RegionPreference.BOTH,
    labelAr: '🌍 السوق العربي والدولي معاً (موصى به)',
    labelEn: '🌍 Arab & International Markets (Recommended)',
  },
  {
    key: RegionPreference.ARAB,
    labelAr: '🏢 السوق العربي وفرص الشرق الأوسط',
    labelEn: '🏢 Arab & Middle East Market Only',
  },
  {
    key: RegionPreference.INTERNATIONAL,
    labelAr: '🌐 السوق الدولي والعمل عن بعد عالمياً',
    labelEn: '🌐 International & Global Remote Only',
  },
];

/**
 * Builds the inline keyboard for selecting the target job market / region preference.
 * Highlights the currently selected option with a checkmark (✅).
 * Includes "Back / رجوع" and "Next / التالي" navigation controls.
 */
export function buildRegionKeyboard(
  selectedRegion: RegionPreference = RegionPreference.BOTH,
  lang: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const option of REGION_OPTIONS) {
    const isSelected = selectedRegion === option.key;
    const baseLabel = lang === 'ar' ? option.labelAr : option.labelEn;
    const label = `${isSelected ? '✅ ' : ''}${baseLabel}`;

    keyboard.text(label, `region_select:${option.key}`).row();
  }

  // Navigation row: Back and Next
  const backLabel = lang === 'ar' ? 'السابق ↩️' : 'Back ↩️';
  const nextLabel = lang === 'ar' ? 'التالي ⬅️' : 'Next ➡️';

  keyboard.text(backLabel, 'region_back').text(nextLabel, 'region_submit');

  return keyboard;
}
