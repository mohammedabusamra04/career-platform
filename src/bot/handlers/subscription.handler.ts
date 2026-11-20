import type { Bot } from 'grammy';

import type { BotContext } from '../context.js';
import type { SupportedLanguage } from '../session.js';
import { subscriptionService } from '../../modules/subscriptions/subscription.service.js';

export function registerSubscriptionHandler(bot: Bot<BotContext>): void {
  bot.command('subscribe', async (ctx) => {
    const userId = ctx.from?.id;
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const isAr = lang === 'ar';

    if (!userId) {
      await ctx.reply(
        isAr
          ? '❌ تعذر التعرف على حساب تيليجرام الخاص بك.'
          : '❌ Unable to identify your Telegram account.',
      );
      return;
    }

    await subscriptionService.subscribe(userId);

    await ctx.reply(
      isAr
        ? '✅ تم تفعيل اشتراكك بنجاح — رادار DeployMe صار Live!\n\n' +
            '📡 رح توصلك الفرص المطابقة لـ Stack تبعك تلقائياً أول بأول.'
        : '✅ Subscribed — your DeployMe pipeline is now live!\n\n' +
            '📡 You will automatically receive job pings tailored to your stack.',
    );
  });

  bot.command('unsubscribe', async (ctx) => {
    const userId = ctx.from?.id;
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const isAr = lang === 'ar';

    if (!userId) {
      await ctx.reply(
        isAr
          ? '❌ تعذر التعرف على حساب تيليجرام الخاص بك.'
          : '❌ Unable to identify your Telegram account.',
      );
      return;
    }

    await subscriptionService.unsubscribe(userId);

    await ctx.reply(
      isAr
        ? '🔕 تم إيقاف اشتراكك في الـ Pipeline بنجاح.\n\n' +
            'لن تصلك إشعارات تلقائية بعد الآن. لإعادة التفعيل بأي وقت ابعت /subscribe.'
        : '🔕 Unsubscribed from DeployMe job pings.\n\n' +
            'Automated pipeline alerts are now off. Send /subscribe anytime to re-enable.',
    );
  });

  const handleSubscriptionStatus = async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    const lang: SupportedLanguage = ctx.session?.language ?? 'ar';
    const isAr = lang === 'ar';

    if (!userId) {
      await ctx.reply(
        isAr
          ? '❌ تعذر التعرف على حساب تيليجرام الخاص بك.'
          : '❌ Unable to identify your Telegram account.',
      );
      return;
    }

    const isSubscribed = await subscriptionService.isSubscribed(userId);

    if (isSubscribed) {
      await ctx.reply(
        isAr
          ? '📡 *حالة الرادار:* شغال (Live) ✅\n\n' +
              'الـ Pipeline تبعك مفعّل وبنراقب السوق لـ Stack تبعك.\n' +
              'لإيقاف التنبيهات مؤقتاً استخدم /pause أو للإلغاء استخدم /unsubscribe.'
          : '📡 *Pipeline Status:* Live ✅\n\n' +
              'Your DeployMe radar is actively scanning roles for your stack.\n' +
              'Use /pause to take a break or /unsubscribe to turn off alerts.',
        { parse_mode: 'Markdown' },
      );

      return;
    }

    await ctx.reply(
      isAr
        ? '🔕 *حالة الرادار:* غير مفعّل\n\n' +
            'أنت غير مشترك حالياً في الـ Pipeline.\n' +
            'ابعت /subscribe لتشغيل الرادار واستلام الفرص المطابقة.'
        : '🔕 *Pipeline Status:* Inactive\n\n' +
            'You are currently unsubscribed from job pings.\n' +
            'Send /subscribe to activate your radar and receive matching roles.',
      { parse_mode: 'Markdown' },
    );
  };

  bot.command('subscription', handleSubscriptionStatus);

  if (typeof bot.hears === 'function') {
    bot.hears(
      [
        '📡 حالة الرادار',
        '📡 Pipeline Status',
        '🔔 Subscription Status',
        'Subscription Status',
        'Subscription',
      ],
      handleSubscriptionStatus,
    );
  }
}