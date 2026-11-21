import type { MatchedJob } from '../../matching/matching.service.js';
import { formatMatchTone } from './digest-card.formatter.js';

export function formatJobMessage(
  matchedJob: MatchedJob,
  lang: 'ar' | 'en' = 'ar',
): string {
  const { job, score } = matchedJob;

  const targetUrl =
    (job as { applicationUrl?: string | null; url?: string | null }).applicationUrl ||
    (job as { url?: string | null }).url ||
    '';

  const matchTone = formatMatchTone(score, lang);

  if (lang === 'en') {
    const locationParts = [
      job.location ? `🌍 ${job.location}` : '',
      job.country ? `📍 ${job.country}` : '',
    ].filter(Boolean);

    const lines = [
      `⚡ DeployMe Ping — ${matchTone}`,
      ``,
      `💻 ${job.title}`,
      `🏢 Company: ${job.company}`,
      locationParts.length > 0 ? locationParts.join(' • ') : '',
      job.source ? `🌐 Source: ${job.source}` : '',
      targetUrl ? `🔗 Apply Now: ${targetUrl}` : '',
    ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '');

    return lines.join('\n').trim();
  }

  const locationParts = [
    job.location ? `🌍 ${job.location}` : '',
    job.country ? `📍 ${job.country}` : '',
  ].filter(Boolean);

  const lines = [
    `⚡ Ping جديد من DeployMe — ${matchTone}`,
    ``,
    `💻 ${job.title}`,
    `🏢 الشركة: ${job.company}`,
    locationParts.length > 0 ? locationParts.join(' • ') : '',
    job.source ? `🌐 المصدر: ${job.source}` : '',
    targetUrl ? `🔗 التقديم المباشر: ${targetUrl}` : '',
  ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '');

  return lines.join('\n').trim();
}