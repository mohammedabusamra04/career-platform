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
 * Builds an inline keyboard containing thumbs up (👍) and thumbs down (👎)
 * feedback buttons for jobs displayed on the current digest page.
 *
 * For a single job: [👍] [👎]
 * For multiple jobs: [👍 1] [👎 1] [👍 2] [👎 2], 2 jobs per row for compact display.
 */
export function buildDigestFeedbackKeyboard(
  jobs: Array<DigestJobFeedbackItem | string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!jobs || jobs.length === 0) {
    return keyboard;
  }

  const isSingleJob = jobs.length === 1;

  for (let i = 0; i < jobs.length; i++) {
    const item = jobs[i];
    const jobId = typeof item === 'string' ? item : (item.id || item.jobId);
    if (!jobId) continue;

    const jobNum = i + 1;
    const likeText = isSingleJob ? '👍' : `👍 ${jobNum}`;
    const dislikeText = isSingleJob ? '👎' : `👎 ${jobNum}`;

    keyboard.text(likeText, `feedback:like:${jobId}`);
    keyboard.text(dislikeText, `feedback:dislike:${jobId}`);

    // Break into a new row after every 2 jobs (4 buttons max per row)
    if ((i + 1) % 2 === 0 && i < jobs.length - 1) {
      keyboard.row();
    }
  }

  return keyboard;
}

/**
 * Builds an inline keyboard for Telegram digest pagination and job feedback:
 * - Thumbs up (👍) and thumbs down (👎) feedback buttons for candidate jobs on the page.
 * - [Prev] button (when currentPage > 1)
 * - [Page indicator] non-action button in center
 * - [Next] button (when currentPage < totalPages)
 *
 * Callback data pattern:
 * - Feedback: `feedback:like:<jobId>` and `feedback:dislike:<jobId>`
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

  // 1. Attach feedback buttons if candidate jobs are provided
  if (jobs && jobs.length > 0) {
    const isSingleJob = jobs.length === 1;

    for (let i = 0; i < jobs.length; i++) {
      const item = jobs[i];
      const jobId = typeof item === 'string' ? item : (item.id || item.jobId);
      if (!jobId) continue;

      const jobNum = i + 1;
      const likeText = isSingleJob ? '👍' : `👍 ${jobNum}`;
      const dislikeText = isSingleJob ? '👎' : `👎 ${jobNum}`;

      keyboard.text(likeText, `feedback:like:${jobId}`);
      keyboard.text(dislikeText, `feedback:dislike:${jobId}`);

      // Break into a new row after every 2 jobs (4 buttons max per row)
      if ((i + 1) % 2 === 0 && i < jobs.length - 1) {
        keyboard.row();
      }
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

