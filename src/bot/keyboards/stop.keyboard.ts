import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export function buildStopKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (lang === 'ar') {
    keyboard
      .text('نعم، حذف البيانات ❌', 'stop_confirm')
      .row()
      .text('تراجع ↩️', 'stop_cancel');
  } else {
    keyboard
      .text('Yes, Delete My Data ❌', 'stop_confirm')
      .row()
      .text('Cancel ↩️', 'stop_cancel');
  }

  return keyboard;
}
