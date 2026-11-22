import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';

export interface DigestJobFeedbackItem {
  id?: string;
  jobId?: string;
}

export interface DigestPaginationKeyboardOptions {
  currentPage: number;
  totalPages: number;
  language?: SupportedLanguage;
  jobs?: Array<DigestJobFeedbackItem | string>;
}

/**
 * Builds an inline keyboard containing 5-star rating (⭐ 1 to ⭐ 5)
 * feedback buttons for jobs displayed on the current digest page.
 */
export function buildDigestFeedbackKeyboard(
  jobs: Array<DigestJobFeedbackItem | string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!jobs || jobs.length === 0) {
    return keyboard;
  }

  for (let s = 1; s <= 5; s++) {
    keyboard.text(`⭐ ${s}`, `feedback:rate:${s}`);
  }

  return keyboard;
}

/**
 * Builds an inline keyboard for Telegram digest pagination and job feedback:
 * - 5-star rating (⭐ 1 to ⭐ 5) feedback buttons for candidate jobs on the page.
 * - [Prev] button (when currentPage > 1)
 * - [Page indicator] non-action button in center
 * - [Next] button (when currentPage < totalPages)
 *
 * Callback data pattern:
 * - Rating: `feedback:rate:<1-5>`
 * - Previous page: `digest:page:<targetPage>`
 * - Next page: `digest:page:<targetPage>`
 * - Current indicator: `digest:noop`
 */
export function buildDigestPaginationKeyboard(
  currentPage: number,
  totalPages: number,
  language: SupportedLanguage = 'ar',
  jobs?: Array<DigestJobFeedbackItem | string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // 1. Attach 5-star rating buttons if candidate jobs are provided
  if (jobs && jobs.length > 0) {
    for (let s = 1; s <= 5; s++) {
      keyboard.text(`⭐ ${s}`, `feedback:rate:${s}`);
    }

    // Move to next row for pagination controls if pagination exists
    if (totalPages > 1) {
      keyboard.row();
    }
  }

  // 2. Attach pagination controls if there are multiple pages
  if (totalPages > 1) {
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
  }

  return keyboard;
}

