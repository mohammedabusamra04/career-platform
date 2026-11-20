import { InlineKeyboard } from 'grammy';
import { RegionPreference } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';

export interface RegionOption {
  key: RegionPreference;
  icon: string;
  labelAr: string;
  labelEn: string;
}

export const REGION_OPTIONS: RegionOption[] = [
  {
    key: RegionPreference.BOTH,
    icon: '🌍',
    labelAr: 'السوق العربي + الدولي معاً (الأفضل)',
    labelEn: 'Arab + Global Markets (Recommended)',
  },
  {
    key: RegionPreference.ARAB,
    icon: '🏢',
    labelAr: 'السوق العربي والشرق الأوسط فقط',
    labelEn: 'Arab & MENA Market Only',
  },
  {
    key: RegionPreference.INTERNATIONAL,
    icon: '🌐',
    labelAr: 'السوق الدولي وفرص الـ Remote فقط',
    labelEn: 'International & Global Remote Only',
  },
];

/**
 * Builds the inline keyboard for selecting the target job market / region preference.
 * Replaces the default option icon with a checkmark (✅) when selected for a clean UI.
 * Includes "Back / السابق" and "Next / التالي" navigation controls.
 */
export function buildRegionKeyboard(
  selectedRegion: RegionPreference = RegionPreference.BOTH,
  lang: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const option of REGION_OPTIONS) {
    const isSelected = selectedRegion === option.key;
    const baseLabel = lang === 'ar' ? option.labelAr : option.labelEn;
    const prefix = isSelected ? '✅' : option.icon;
    const label = `${prefix} ${baseLabel}`;

    keyboard.text(label, `region_select:${option.key}`).row();
  }

  // Navigation row: Back and Next
  const backLabel = lang === 'ar' ? 'السابق ↩️' : 'Back ↩️';
  const nextLabel = lang === 'ar' ? 'التالي ⬅️' : 'Next ➡️';

  keyboard.text(backLabel, 'region_back').text(nextLabel, 'region_submit');

  return keyboard;
}