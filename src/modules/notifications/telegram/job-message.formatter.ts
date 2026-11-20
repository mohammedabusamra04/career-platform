import type { MatchedJob } from '../../matching/matching.service.js';

export function formatJobMessage(
  matchedJob: MatchedJob,
  lang: 'ar' | 'en' = 'ar',
): string {
  const { job, score } = matchedJob;

  const targetUrl =
    (job as { applicationUrl?: string | null; url?: string | null }).applicationUrl ||
    (job as { url?: string | null }).url ||
    '';

  if (lang === 'en') {
    const locationParts = [
      job.location ? `🌍 ${job.location}` : '',
      job.country ? `📍 ${job.country}` : '',
    ].filter(Boolean);

    const lines = [
      `⚡ DeployMe Ping — ${score}% Stack Fit`,
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
    `⚡ Ping جديد من DeployMe — تطابق ${score}%`,
    ``,
    `💻 ${job.title}`,
    `🏢 الشركة: ${job.company}`,
    locationParts.length > 0 ? locationParts.join(' • ') : '',
    job.source ? `🌐 المصدر: ${job.source}` : '',
    targetUrl ? `🔗 التقديم المباشر: ${targetUrl}` : '',
  ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '');

  return lines.join('\n').trim();
}