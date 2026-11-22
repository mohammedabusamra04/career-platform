import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export interface ExperienceOption {
  id: string;
  labelAr: string;
  labelEn: string;
}

export const EXPERIENCE_OPTIONS: ExperienceOption[] = [
  { id: 'JUNIOR', labelAr: 'Junior (مبتدئ)', labelEn: 'Junior / Entry-Level' },
  { id: 'MID', labelAr: 'Mid-Level (متوسط)', labelEn: 'Mid-Level' },
  { id: 'SENIOR', labelAr: 'Senior (متقدم / خبير)', labelEn: 'Senior / Lead' },
  { id: 'ALL', labelAr: 'الكل (مفتوح للجميع)', labelEn: 'Open to All Levels' },
];

/**
 * Builds the inline keyboard for Step 3: Experience Level selection.
 * Displays a checkmark (✅) on the selected level option.
 * Includes "Back / السابق" and "Next / التالي" navigation controls.
 */
export function buildExperienceKeyboard(
  selectedLevel: string = 'ALL',
  lang: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isAr = lang === 'ar';
  const norm = selectedLevel?.toUpperCase() || 'ALL';

  for (const option of EXPERIENCE_OPTIONS) {
    const isSelected = norm === option.id;
    const prefix = isSelected ? '✅ ' : '';
    const label = `${prefix}${isAr ? option.labelAr : option.labelEn}`;

    keyboard.text(label, `exp_step_select:${option.id}`).row();
  }

  // Navigation row: Back and Next
  const backLabel = isAr ? 'السابق ↩️' : 'Back ↩️';
  const nextLabel = isAr ? 'التالي ⬅️' : 'Next ➡️';

  keyboard.text(backLabel, 'exp_step_back').text(nextLabel, 'exp_step_submit');

  return keyboard;
}

// Backward-compatible static keyboard
export const experienceKeyboard = new InlineKeyboard()
  .text('Intern', 'experience:intern')
  .text('Junior', 'experience:junior')
  .row()
  .text('Mid', 'experience:mid')
  .text('Senior', 'experience:senior')
  .row()
  .text('Lead', 'experience:lead')
  .text('Any', 'experience:any');
