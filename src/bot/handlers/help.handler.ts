import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { SupportedLanguage } from '../session.js';

export const HELP_MESSAGES = {
  ar: `📖 *دليل أوامر DeployMe (ديبلوي مي)*

أهلاً بك! هي قائمة بكل الأوامر المتاحة وكيف تتحكم في الـ Pipeline تبعك:

🔹 /start — بدء الإعداد وضبط الـ Stack ونطاق السوق المستهدف.
🔹 /jobs — استعراض أحدث الفرص المطابقة لـ Stack تبعك فوراً.
🔹 /settings — تعديل تخصصاتك، نطاق السوق، أو لغة البوت.
🔹 /pause — إيقاف الـ Ping مؤقتاً (يوم، أسبوع، أو حتى تشغله يدوياً).
🔹 /resume — إعادة تشغيل الـ Pipeline واستقبال الفرص فوراً.
🔹 /stop — إلغاء الاشتراك وحذف إعداداتك وبياناتك نهائياً.
🔹 /help — عرض هذا الدليل في أي وقت.

💡 *نصيحة:* حدّث الـ Stack تبعك بدقة من /settings عشان الرادار يفلترلك أقوى الفرص بدون أي ضوضاء!`,

  en: `📖 *DeployMe Command Guide*

Welcome! Here is the full list of commands to control your job pipeline:

🔹 /start — Launch onboarding and configure your tech stack & market scope.
🔹 /jobs — Instantly browse active roles matching your stack.
🔹 /settings — Edit your stack, target region, or bot language.
🔹 /pause — Temporarily pause job pings (1 day, 1 week, or until resumed).
🔹 /resume — Bring your pipeline back live immediately.
🔹 /stop — Unsubscribe and permanently delete your config & data.
🔹 /help — Display this command guide anytime.

💡 *Tip:* Keep your stack fine-tuned in /settings so the radar filters the highest-signal roles for you!`,
};

export function registerHelpHandler(bot: Bot<BotContext>): void {
  bot.command('help', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    await ctx.reply(HELP_MESSAGES[lang], {
      parse_mode: 'Markdown',
    });
  });
}