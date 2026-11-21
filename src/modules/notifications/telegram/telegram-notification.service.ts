import type { Bot } from 'grammy';

import type { MatchedJob } from '../../matching/matching.service.js';
import type { NotificationService } from '../notification.service.js';

import {
  MAX_DIGEST_TOTAL_JOBS,
  escapeTelegramMarkdown,
  formatMatchTone,
  getTelegramDigestSendOptions,
  sanitizeApplicationUrl,
} from './digest-card.formatter.js';
import { formatJobMessage } from './job-message.formatter.js';

export type TelegramApi = Pick<Bot['api'], 'sendMessage'>;

const TELEGRAM_MAX_MESSAGE_LENGTH = 3900;

interface PreparedDigestItem {
  index: number;
  text: string;
  url: string;
}

function buildApplyInlineKeyboard(
  items: PreparedDigestItem[],
): Array<Array<{ text: string; url: string }>> {
  const buttons = items
    .filter((item) => item.url.length > 0)
    .map((item) => ({
      text: items.length === 1 ? '⚡ قدّم الآن' : `⚡ قدّم #${item.index}`,
      url: item.url,
    }));

  const rows: Array<Array<{ text: string; url: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

export class TelegramNotificationService implements NotificationService {
  constructor(private readonly api: TelegramApi) {}

  async sendJob(chatId: number, matchedJob: MatchedJob): Promise<void> {
    const message = formatJobMessage(matchedJob);

    try {
      await this.api.sendMessage(chatId, message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Apply Now',
                url: matchedJob.job.applicationUrl,
              },
            ],
          ],
        },
      });
    } catch (error) {
      console.error(`Failed to send job notification to chat ${chatId}:`, error);
    }
  }

  async sendNoJobsMatched(chatId: number): Promise<void> {
    const message =
      '🔍 No new jobs matching your preferences were found at the moment.\n\n' +
      "We'll keep searching and notify you in the next notification schedule as soon as suitable opportunities are available!";

    try {
      await this.api.sendMessage(chatId, message);
    } catch (error) {
      console.error(`Failed to send no-match notification to chat ${chatId}:`, error);
    }
  }

  async sendJobs(chatId: number, matchedJobs: MatchedJob[]): Promise<void> {
    if (matchedJobs.length === 0) {
      await this.sendNoJobsMatched(chatId);
      return;
    }

    const batch = matchedJobs.slice(0, MAX_DIGEST_TOTAL_JOBS);
    const overflowCount = Math.max(0, matchedJobs.length - MAX_DIGEST_TOTAL_JOBS);

    const preparedItems: PreparedDigestItem[] = batch.map((matchedJob, idx) => {
      const { job, score } = matchedJob;
      const itemIndex = idx + 1;
      const safeTitle = escapeTelegramMarkdown(job.title || 'Untitled Role');
      const safeCompany = escapeTelegramMarkdown(job.company || 'Company');
      const rawUrl =
        (job as { applicationUrl?: string | null; url?: string | null }).applicationUrl ||
        job.url;
      const targetUrl = sanitizeApplicationUrl(rawUrl);
      const tone = escapeTelegramMarkdown(formatMatchTone(score, 'ar'));

      const locationPart = [job.location, job.country].filter(Boolean).join(' • ');
      const safeLocation = locationPart ? ` | 📍 ${escapeTelegramMarkdown(locationPart)}` : '';
      const titleLine = targetUrl
        ? `*${itemIndex}.* 💻 [${safeTitle}](${targetUrl})`
        : `*${itemIndex}.* 💻 *${safeTitle}*`;

      return {
        index: itemIndex,
        text: `${titleLine}\n   🏢 ${safeCompany}${safeLocation}\n   ${tone}`,
        url: targetUrl,
      };
    });

    const header =
      `📬 *تجميعة DeployMe المسائية* (${batch.length} ${batch.length === 1 ? 'فرصة' : 'فرص'})\n` +
      `────────────────────\n\n`;

    const footerLines = [
      `\n\n────────────────────`,
      overflowCount > 0
        ? `📌 هناك *${overflowCount}* فرصة إضافية مطابقة لملفك، تصفحها عبر /jobs`
        : `⚡ لتصفح كل الفرص المتاحة والفرز حسب الأنسب اضغط /jobs`,
    ];
    const footer = footerLines.join('\n');

    const baseSendOptions = getTelegramDigestSendOptions();
    const fullMessage = `${header}${preparedItems.map((i) => i.text).join('\n\n')}${footer}`;

    try {
      if (fullMessage.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
        const inlineKeyboard = buildApplyInlineKeyboard(preparedItems);
        await this.api.sendMessage(chatId, fullMessage, {
          ...baseSendOptions,
          ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
        });
        return;
      }

      // Split into chunks only if the 20-job digest exceeds Telegram's 4096-char limit
      const chunks: Array<{ text: string; items: PreparedDigestItem[] }> = [];
      let currentText = header;
      let currentItems: PreparedDigestItem[] = [];

      for (let i = 0; i < preparedItems.length; i++) {
        const item = preparedItems[i];
        const separator = currentItems.length === 0 ? '' : '\n\n';
        const isLastItem = i === preparedItems.length - 1;
        const candidate = `${currentText}${separator}${item.text}${isLastItem ? footer : ''}`;

        if (candidate.length > TELEGRAM_MAX_MESSAGE_LENGTH && currentItems.length > 0) {
          chunks.push({ text: currentText, items: currentItems });
          currentText = item.text + (isLastItem ? footer : '');
          currentItems = [item];
        } else {
          currentText = `${currentText}${separator}${item.text}`;
          currentItems.push(item);
          if (isLastItem) {
            currentText += footer;
          }
        }
      }

      if (currentText.trim().length > 0 && currentItems.length > 0) {
        chunks.push({ text: currentText, items: currentItems });
      }

      for (const chunk of chunks) {
        const inlineKeyboard = buildApplyInlineKeyboard(chunk.items);
        await this.api.sendMessage(chatId, chunk.text, {
          ...baseSendOptions,
          ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
        });
      }
    } catch (error) {
      console.error(`Failed to send digest notification to chat ${chatId}:`, error);
    }
  }
}
