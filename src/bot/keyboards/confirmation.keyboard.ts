import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

/**
 * Builds the inline keyboard for Step 3: Confirmation and Editing.
 */
export function buildConfirmationKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const confirmLabel = lang === 'ar' ? 'تأكيد وحفظ ✅' : 'Confirm & Save ✅';
  const editLabel = lang === 'ar' ? 'تعديل الاختيارات ✏️' : 'Edit Preferences ✏️';

  keyboard.text(confirmLabel, 'pref_confirm').row();
  keyboard.text(editLabel, 'pref_edit');

  return keyboard;
}

// Backward compatibility export for legacy preferences handler
export const confirmationKeyboard = buildConfirmationKeyboard('en');
