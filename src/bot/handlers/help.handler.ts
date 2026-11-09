import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { SupportedLanguage } from '../session.js';

export const HELP_MESSAGES = {
  ar: `📖 *دليل أوامر المنصة الذكية للتوظيف*

مرحباً بك! إليك قائمة بجميع الأوامر المتاحة وكيفية استخدامها:

🔹 /start — بدء الاستخدام وضبط التخصصات والمناطق المستهدفة.
🔹 /jobs — استعراض أحدث الوظائف المطابقة لتفضيلاتك الحالية فوراً.
🔹 /settings — تعديل تخصصاتك المهنية، النطاق الجغرافي، أو لغة البوت.
🔹 /pause — إيقاف التنبيهات مؤقتاً (لمدة يوم، أسبوع، أو حتى الاستئناف يدوياً).
🔹 /resume — استئناف استقبال تنبيهات وإشعارات الوظائف فوراً.
🔹 /stop — إلغاء الاشتراك وحذف تفضيلاتك وبياناتك الشخصية نهائياً.
🔹 /help — عرض هذا الدليل الإرشادي في أي وقت.

💡 *نصيحة:* تأكد من ضبط تخصصاتك بدقة عبر /settings لتصلك الفرص الأكثر ملاءمة لمهاراتك!`,

  en: `📖 *AI Career Platform Command Guide*

Welcome! Here is the complete list of available bot commands and their usage:

🔹 /start — Start onboarding and set up your job preferences.
🔹 /jobs — Instantly browse latest jobs matching your preferences.
🔹 /settings — Edit your career specializations, target region, or language.
🔹 /pause — Temporarily pause job alerts (1 day, 1 week, or indefinitely).
🔹 /resume — Resume receiving job alerts immediately.
🔹 /stop — Unsubscribe and delete your preferences and personal data.
🔹 /help — Display this guide anytime.

💡 *Tip:* Make sure to fine-tune your preferences in /settings to receive the most relevant opportunities!`,
};

export function registerHelpHandler(bot: Bot<BotContext>): void {
  bot.command('help', async (ctx) => {
    const lang: SupportedLanguage = ctx.session.language ?? 'ar';
    await ctx.reply(HELP_MESSAGES[lang], {
      parse_mode: 'Markdown',
    });
  });
}
