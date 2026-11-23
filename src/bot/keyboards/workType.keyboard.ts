import { InlineKeyboard } from 'grammy';

export const workTypeKeyboard = new InlineKeyboard()
  .text('Remote', 'work-type:remote')
  .text('Hybrid', 'work-type:hybrid')
  .row()
  .text('On-site', 'work-type:on-site')
  .text('Any', 'work-type:any');


