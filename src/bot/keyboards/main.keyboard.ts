import { InlineKeyboard, Keyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export function buildStartInlineKeyboard(lang: SupportedLanguage = 'ar'): InlineKeyboard {
  const label = lang === 'ar' ? '⚡ ابدأ البحث عن فرص (Deploy)' : '⚡ Start Job Search';
  return new InlineKeyboard().text(label, 'start_search');
}

export function buildStartReplyKeyboard(lang: SupportedLanguage = 'ar'): Keyboard {
  const startLabel = lang === 'ar' ? '⚡ ابدأ البحث' : '⚡ Start Job Search';
  const statusLabel = lang === 'ar' ? '📡 حالة الرادار' : '📡 Pipeline Status';

  return new Keyboard()
    .text(startLabel)
    .text(statusLabel)
    .resized()
    .persistent();
}

// Backward compatibility exports
export const startInlineKeyboard = new InlineKeyboard().text(
  '⚡ Start Job Search',
  'start_search',
);

export const startReplyKeyboard = new Keyboard()
  .text('⚡ Start Job Search')
  .text('📡 Pipeline Status')
  .resized()
  .persistent();

export const mainKeyboard = startInlineKeyboard;