import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export function buildPauseKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (lang === 'ar') {
    keyboard
      .text('لمدة يوم (24 ساعة) ⏱️', 'pause_1d')
      .text('لمدة أسبوع (7 أيام) 📅', 'pause_7d')
      .row()
      .text('حتى أقوم بالاستئناف يدوياً ⏸️', 'pause_indefinite')
      .row()
      .text('إلغاء ❌', 'pause_cancel');
  } else {
    keyboard
      .text('1 Day (24h) ⏱️', 'pause_1d')
      .text('1 Week (7d) 📅', 'pause_7d')
      .row()
      .text('Until Manually Resumed ⏸️', 'pause_indefinite')
      .row()
      .text('Cancel ❌', 'pause_cancel');
  }

  return keyboard;
}
