import { InlineKeyboard } from 'grammy';
import type { SupportedLanguage } from '../session.js';
import type { JobSortOrder, ExplorerJobItem } from '../../modules/jobs/job-explorer.service.js';

export interface JobExplorerKeyboardOptions {
  currentPage: number;
  totalPages: number;
  sort?: JobSortOrder;
  language?: SupportedLanguage;
  jobs?: ExplorerJobItem[];
}

/**
 * Builds the interactive inline keyboard for the `/jobs` database explorer:
 * 1. Feedback buttons row(s) for each job on the active page (👍 / 👎).
 * 2. Sorting toggle button (Best Match vs Latest).
 * 3. Keyset navigation buttons (Prev, Page indicator, Next).
 */
export function buildJobExplorerKeyboard(options: JobExplorerKeyboardOptions): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const { currentPage, totalPages, sort = 'BEST_MATCH', language = 'ar', jobs = [] } = options;
  const isArabic = language === 'ar';

  // 1. Feedback buttons for jobs on the current page
  if (jobs.length > 0) {
    const isSingleJob = jobs.length === 1;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job.id) continue;

      const jobNum = i + 1;
      const likeText = isSingleJob ? '👍' : `👍 ${jobNum}`;
      const dislikeText = isSingleJob ? '👎' : `👎 ${jobNum}`;

      keyboard.text(likeText, `feedback:like:${job.id}`);
      keyboard.text(dislikeText, `feedback:dislike:${job.id}`);

      // Two jobs per row (4 buttons max)
      if ((i + 1) % 2 === 0 && i < jobs.length - 1) {
        keyboard.row();
      }
    }

    keyboard.row();
  }

  // 2. Sorting Toggle button
  const nextSort: JobSortOrder = sort === 'BEST_MATCH' ? 'LATEST' : 'BEST_MATCH';
  const sortToggleLabel =
    sort === 'BEST_MATCH'
      ? isArabic
        ? '🔄 التبديل إلى: الأحدث ⏱️'
        : '🔄 Switch to: Latest ⏱️'
      : isArabic
        ? '🔄 التبديل إلى: الأنسب 🎯'
        : '🔄 Switch to: Best Match 🎯';

  keyboard.text(sortToggleLabel, `jobs:sort:${nextSort}`).row();

  // 3. Pagination controls if more than 1 page exists
  if (totalPages > 1) {
    const safeCurrent = Math.max(1, Math.min(currentPage, totalPages));
    const prevText = isArabic ? '◀️ السابق' : '◀️ Prev';
    const nextText = isArabic ? 'التالي ▶️' : 'Next ▶️';
    const indicatorText = `📄 ${safeCurrent}/${totalPages}`;

    if (safeCurrent > 1) {
      keyboard.text(prevText, `jobs:page:${safeCurrent - 1}`);
    }

    keyboard.text(indicatorText, 'jobs:noop');

    if (safeCurrent < totalPages) {
      keyboard.text(nextText, `jobs:page:${safeCurrent + 1}`);
    }
  }

  return keyboard;
}

/**
 * Builds an empty-state keyboard prompting the candidate to adjust settings or broaden market scope.
 */
export function buildJobExplorerEmptyKeyboard(language: SupportedLanguage = 'ar'): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isArabic = language === 'ar';

  const editSpecsLabel = isArabic ? 'تعديل التخصصات 🛠️' : 'Edit Specializations 🛠️';
  const expandRegionLabel = isArabic ? 'توسيع نطاق السوق 🌍' : 'Expand Target Region 🌍';

  keyboard.text(editSpecsLabel, 'settings_edit_specs').row();
  keyboard.text(expandRegionLabel, 'settings_edit_region');

  return keyboard;
}
