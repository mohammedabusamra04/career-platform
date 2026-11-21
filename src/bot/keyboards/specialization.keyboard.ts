import { InlineKeyboard } from 'grammy';
import { Specialization } from '../../modules/preferences/preference.taxonomy.js';
import type { SupportedLanguage } from '../session.js';

export interface SpecializationOption {
  key: Specialization;
  label: string;
}

export const SPECIALIZATION_OPTIONS: SpecializationOption[] = [
  { key: Specialization.BACKEND, label: 'Backend' },
  { key: Specialization.FRONTEND, label: 'Frontend' },
  { key: Specialization.FULLSTACK, label: 'Full-Stack' },
  { key: Specialization.MOBILE, label: 'Mobile' },
  { key: Specialization.DEVOPS, label: 'DevOps' },
  { key: Specialization.UIUX, label: 'UI/UX' },
  { key: Specialization.DATA, label: 'Data' },
  { key: Specialization.QA, label: 'QA / Testing' },
  { key: Specialization.SECURITY, label: 'Security' },
  { key: Specialization.AI_ENGINEER, label: 'AI / ML' },
];

/**
 * Builds a 2-column inline keyboard for 10 approved specializations with toggle state.
 * Includes a neutral language toggle button and a "Confirm Stack" submission button.
 */
export function buildSpecializationKeyboard(
  selected: Specialization[] = [],
  lang: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Top row: Language Switcher prominently positioned at the top for immediate accessibility
  const langSwitchLabel = lang === 'ar' ? '🌐 English' : '🌐 العربية';
  keyboard.text(langSwitchLabel, 'toggle_language').row();

  // Add 10 specializations in 2 columns
  for (let i = 0; i < SPECIALIZATION_OPTIONS.length; i += 2) {
    const left = SPECIALIZATION_OPTIONS[i];
    const right = SPECIALIZATION_OPTIONS[i + 1];

    const leftChecked = selected.includes(left.key);
    const leftLabel = `${leftChecked ? '✅' : '▫️'} ${left.label}`;
    keyboard.text(leftLabel, `spec_toggle:${left.key}`);

    if (right) {
      const rightChecked = selected.includes(right.key);
      const rightLabel = `${rightChecked ? '✅' : '▫️'} ${right.label}`;
      keyboard.text(rightLabel, `spec_toggle:${right.key}`);
    }

    keyboard.row();
  }

  // Bottom row: Submit action
  const nextLabel = lang === 'ar' ? 'تأكيد الـ Stack ⬅️' : 'Confirm Stack ➡️';
  keyboard.text(nextLabel, 'spec_submit');

  return keyboard;
}