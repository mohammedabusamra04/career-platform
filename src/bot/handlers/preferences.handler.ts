import type { Bot } from 'grammy';

import type { BotContext } from '../context.js';
import type { SupportedLanguage } from '../session.js';

import { buildConfirmationKeyboard, confirmationKeyboard } from '../keyboards/confirmation.keyboard.js';
import { experienceKeyboard } from '../keyboards/experience.keyboard.js';
import { workTypeKeyboard } from '../keyboards/work-type.keyboard.js';

import {
  isValidExperienceLevel,
  isValidWorkType,
  normalizeJobTitle,
  normalizeLocation,
  normalizeSkills,
  validateJobTitle,
} from '../../modules/preferences/preference.validator.js';

import { preferenceService } from '../../modules/preferences/preference.service.js';
import { subscriptionService } from '../../modules/subscriptions/subscription.service.js';

export function registerPreferencesHandler(bot: Bot<BotContext>): void {
  bot.on('message:text', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    switch (ctx.session.step) {
      case 'job-title': {
        const jobTitle = normalizeJobTitle(ctx.message.text);

        if (!validateJobTitle(jobTitle)) {
          await ctx.reply(
            isAr
              ? '❌ اكتب مسمى وظيفي صحيح (بين 2 و 100 حرف).'
              : '❌ Please enter a valid job title (2–100 characters).',
          );

          return;
        }

        ctx.session.preferences.jobTitle = jobTitle;
        ctx.session.step = 'work-type';

        await ctx.reply(
          isAr
            ? 'تمام! 👍\n\nشو نظام الشغل اللي بتفضله؟'
            : 'Locked in! 👍\n\nWhat work setup do you prefer?',
          {
            reply_markup: workTypeKeyboard,
          },
        );

        return;
      }

      case 'location': {
        const location = normalizeLocation(ctx.message.text);

        ctx.session.preferences.location = location;
        ctx.session.step = 'skills';

        await ctx.reply(
          isAr
            ? '📍 تم حفظ الموقع.\n\n' +
                'شو أهم المهارات والـ Stack تبعك؟\n\n' +
                'مثال: Node.js, TypeScript, PostgreSQL, Redis'
            : '📍 Location saved.\n\n' +
                'Drop your core tech stack & skills:\n\n' +
                'Example: Node.js, TypeScript, PostgreSQL, Redis',
        );

        return;
      }

      case 'skills': {
        const skills = normalizeSkills(ctx.message.text);

        if (skills.length === 0) {
          await ctx.reply(
            isAr
              ? '❌ اكتب مهارة واحدة ع الأقل عشان نقدر نفلترلك الفرص.\n\n' +
                  'مثال: Node.js, TypeScript, PostgreSQL'
              : '❌ Please enter at least one skill to filter your feed.\n\n' +
                  'Example: Node.js, TypeScript, PostgreSQL',
          );

          return;
        }

        ctx.session.preferences.skills = skills;
        ctx.session.step = 'confirmation';

        const { jobTitle, workType, experienceLevel, location } = ctx.session.preferences;
        const replyMarkup =
          typeof buildConfirmationKeyboard === 'function'
            ? buildConfirmationKeyboard(lang)
            : confirmationKeyboard;

        await ctx.reply(
          isAr
            ? '📋 راجع إعدادات الـ Pipeline تبعك قبل التشغيل:\n\n' +
                `💻 المسمى الوظيفي: ${jobTitle}\n` +
                `🏢 نظام العمل: ${workType}\n` +
                `📊 مستوى الخبرة: ${experienceLevel}\n` +
                `📍 الموقع: ${location ?? 'الكل (Any)'}\n` +
                `🛠 الـ Stack: ${skills.join(', ')}`
            : '📋 Review your DeployMe pipeline config:\n\n' +
                `💻 Role: ${jobTitle}\n` +
                `🏢 Work Setup: ${workType}\n` +
                `📊 Seniority: ${experienceLevel}\n` +
                `📍 Location: ${location ?? 'Any'}\n` +
                `🛠 Tech Stack: ${skills.join(', ')}`,
          {
            reply_markup: replyMarkup,
          },
        );

        return;
      }

      default:
        return;
    }
  });

  bot.callbackQuery(/^work-type:(.+)$/, async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    if (ctx.session.step !== 'work-type') {
      await ctx.answerCallbackQuery();

      return;
    }

    const workType = ctx.match[1];

    if (!isValidWorkType(workType)) {
      await ctx.answerCallbackQuery({
        text: isAr ? '❌ خيار غير صالح.' : '❌ Invalid work type.',
        show_alert: true,
      });

      return;
    }

    ctx.session.preferences.workType = workType;
    ctx.session.step = 'experience-level';

    await ctx.answerCallbackQuery();

    await ctx.reply(
      isAr
        ? `تم اختيار نظام العمل: ${workType}\n\nشو مستوى خبرتك الحالي؟`
        : `Work setup: ${workType}\n\nWhat is your seniority level?`,
      {
        reply_markup: experienceKeyboard,
      },
    );
  });

  bot.callbackQuery(/^experience:(.+)$/, async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    if (ctx.session.step !== 'experience-level') {
      await ctx.answerCallbackQuery();

      return;
    }

    const experienceLevel = ctx.match[1];

    if (!isValidExperienceLevel(experienceLevel)) {
      await ctx.answerCallbackQuery({
        text: isAr ? '❌ مستوى خبرة غير صالح.' : '❌ Invalid experience level.',
        show_alert: true,
      });

      return;
    }

    ctx.session.preferences.experienceLevel = experienceLevel;
    ctx.session.step = 'location';

    await ctx.answerCallbackQuery();

    await ctx.reply(
      isAr
        ? `مستوى الخبرة: ${experienceLevel}\n\n` +
            'وين بتفضل يكون موقع الشغل؟\n\n' +
            'اكتب اسم الدولة/المدينة أو اكتب "any" لكل الأماكن.'
        : `Seniority: ${experienceLevel}\n\n` +
            'What is your preferred location?\n\n' +
            'Type a city/country or "any" for global.',
    );
  });

  bot.callbackQuery('preferences:confirm', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    if (ctx.session.step !== 'confirmation') {
      await ctx.answerCallbackQuery();

      return;
    }

    const userId = ctx.from?.id;

    if (!userId) {
      await ctx.answerCallbackQuery({
        text: isAr ? '❌ تعذر التعرف على حساب تيليجرام.' : '❌ Unable to identify your Telegram account.',
        show_alert: true,
      });

      return;
    }

    const preferences = ctx.session.preferences;

    if (!preferences.jobTitle || !preferences.workType || !preferences.experienceLevel) {
      await ctx.answerCallbackQuery({
        text: isAr ? '❌ يرجى إكمال جميع الحقول المطلوبة أولاً.' : '❌ Please complete all required preferences.',
        show_alert: true,
      });

      return;
    }

    const savedPreferences = preferenceService.createPreferences({
      jobTitle: preferences.jobTitle,
      workType: preferences.workType,
      experienceLevel: preferences.experienceLevel,
      location: preferences.location,
      skills: preferences.skills?.join(','),
    });

    await preferenceService.savePreferences(userId, savedPreferences);
    await subscriptionService.subscribe(userId);

    await ctx.answerCallbackQuery();

    await ctx.reply(
      isAr
        ? '✅ تم حفظ إعداداتك وتشغيل الـ Pipeline بنجاح!\n\n' +
            '📡 رادار DeployMe صار يراقب السوق — أول ما تنزل فرصة بتطابق الـ Stack تبعك رح نعملك Ping فوراً.'
        : '✅ Config saved — your DeployMe pipeline is live!\n\n' +
            "📡 We're now scanning the market and will ping you the moment a role matches your stack.",
    );
  });

  bot.callbackQuery('preferences:restart', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    ctx.session = {
      step: 'job-title',
      language: lang,
      preferences: {},
    };

    await ctx.answerCallbackQuery();

    await ctx.reply(
      isAr
        ? '🔄 يلا نبدأ من جديد.\n\nشو المسمى الوظيفي اللي بتدور عليه؟'
        : "🔄 Resetting config.\n\nWhat role are you targeting?",
    );
  });

  bot.callbackQuery('preferences:update', async (ctx) => {
    const lang: SupportedLanguage = ctx.session?.language || 'en';
    const isAr = lang === 'ar';

    ctx.session.step = 'job-title';

    await ctx.answerCallbackQuery();

    await ctx.reply(
      isAr
        ? '✏️ خلينا نحدّث إعداداتك.\n\nشو المسمى الوظيفي الجديد اللي بتدور عليه؟'
        : "✏️ Let's update your stack config.\n\nWhat role are you targeting?",
    );
  });
}