import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export interface DigestPaginationKeyboardOptions {
  currentPage: number;
  totalPages: number;
  language?: SupportedLanguage;
}

/**
 * Builds an inline keyboard for Telegram digest pagination:
 * - [Prev] button (when currentPage > 1)
 * - [Page indicator] non-action button in center
 * - [Next] button (when currentPage < totalPages)
 *
 * Callback data pattern:
 * - Previous page: `digest:page:<targetPage>`
 * - Next page: `digest:page:<targetPage>`
 * - Current indicator: `digest:noop`
 */
export function buildDigestPaginationKeyboard(
  currentPage: number,
  totalPages: number,
  language: SupportedLanguage = 'ar',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (totalPages <= 1) {
    return keyboard;
  }

  const safeCurrent = Math.max(1, Math.min(currentPage, totalPages));
  const isArabic = language === 'ar';

  const prevText = isArabic ? '◀️ السابق' : '◀️ Prev';
  const nextText = isArabic ? 'التالي ▶️' : 'Next ▶️';
  const pageIndicatorText = `📄 ${safeCurrent}/${totalPages}`;

  // Previous page button (only if not on first page)
  if (safeCurrent > 1) {
    keyboard.text(prevText, `digest:page:${safeCurrent - 1}`);
  }

  // Non-action page indicator button
  keyboard.text(pageIndicatorText, 'digest:noop');

  // Next page button (only if not on last page)
  if (safeCurrent < totalPages) {
    keyboard.text(nextText, `digest:page:${safeCurrent + 1}`);
  }

  return keyboard;
}

