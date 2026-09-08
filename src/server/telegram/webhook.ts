import { eq } from 'drizzle-orm';

import { siteUrl } from '@/lib/site-url';
import { db } from '@/server/db/client';
import { orders } from '@/server/db/schema';
import { getOrderView, updateOrderStatus } from '@/server/services/orders';
import { getSettings } from '@/server/services/settings';
import { answerCallbackQuery, editMessageText } from './client';
import { isTelegramConfigured } from './config';
import { parseCallbackData, renderOrderMessage, STATUS_LABEL, statusButtons } from './message';

/**
 * Acting on a button press from Telegram.
 *
 * Two things authorise this and they do different jobs. The secret header —
 * checked by the route before anything reaches here — proves the request came
 * from Telegram rather than from someone who found the URL. The chat check
 * below proves it came from a chat the owner configured, rather than from
 * anyone who happened to be forwarded the message. Neither alone is enough.
 *
 * Every status change goes through `updateOrderStatus`. There is no second
 * state machine here and there must never be one: the transition is decided
 * inside the same transaction the panel uses, against the row's current status,
 * so a stale message from an hour ago cannot move a delivered order.
 *
 * Answering always returns 200. Telegram redelivers anything else, and a
 * message that is redelivered forever because our database was briefly down is
 * worse than one lost press — the panel is right there.
 */

export interface TelegramUpdate {
  update_id?: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id: number;
      chat?: { id?: number | string };
    };
  };
}

export type WebhookOutcome =
  | { handled: true; status: string }
  | { handled: false; reason: 'NOT_CONFIGURED' | 'IGNORED' | 'UNAUTHORISED_CHAT' | 'BAD_DATA' | 'NOT_FOUND' | 'REJECTED' };

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<WebhookOutcome> {
  if (!isTelegramConfigured()) return { handled: false, reason: 'NOT_CONFIGURED' };

  const callback = update.callback_query;
  // Anything that is not a button press — a chat message, a new member, a
  // command we do not implement — is deliberately ignored rather than answered.
  if (!callback) return { handled: false, reason: 'IGNORED' };

  const chatId = callback.message?.chat?.id;
  const settings = await getSettings();
  const allowed = settings.telegramChatIds.filter((id) => id.trim().length > 0);

  if (chatId === undefined || !allowed.includes(String(chatId))) {
    // Not an error to report back: whoever this is should learn nothing about
    // whether the order exists.
    await answerCallbackQuery({ callbackQueryId: callback.id, text: 'Нет доступа' });
    return { handled: false, reason: 'UNAUTHORISED_CHAT' };
  }

  const parsed = callback.data ? parseCallbackData(callback.data) : null;
  if (!parsed) {
    await answerCallbackQuery({ callbackQueryId: callback.id });
    return { handled: false, reason: 'BAD_DATA' };
  }

  const [row] = await db
    .select({ id: orders.id, trackingToken: orders.trackingToken })
    .from(orders)
    .where(eq(orders.publicCode, parsed.publicCode))
    .limit(1);

  if (!row) {
    await answerCallbackQuery({ callbackQueryId: callback.id, text: 'Заказ не найден' });
    return { handled: false, reason: 'NOT_FOUND' };
  }

  const result = await updateOrderStatus({
    orderId: row.id,
    to: parsed.to,
    note: null,
    // What the audit trail will say, and how the panel tells a Telegram press
    // apart from a click in the browser.
    source: 'TELEGRAM',
  });

  if (!result.ok) {
    /*
      The interesting case is a repeat. Telegram redelivers an update it did not
      get a 200 for, and two people can press the same button at once; both
      arrive as a transition from a status the order has already left. When the
      order is already where the press wanted it, that is success as far as the
      person pressing is concerned, and saying so is friendlier than an error
      about an illegal transition.
    */
    const already = result.code === 'ILLEGAL_TRANSITION' && result.from === parsed.to;

    await answerCallbackQuery({
      callbackQueryId: callback.id,
      text: already
        ? `Уже: ${STATUS_LABEL[parsed.to]}`
        : result.code === 'ILLEGAL_TRANSITION'
          ? `Нельзя: заказ уже «${STATUS_LABEL[result.from ?? 'NEW']}»`
          : 'Заказ не найден',
    });

    return { handled: false, reason: 'REJECTED' };
  }

  // Redraw the ticket in place, so the message in the chat shows the new status
  // and offers only the moves that are legal from it. Without this the buttons
  // in the chat go stale the moment anybody uses one.
  const view = await getOrderView(row.trackingToken);

  if (view && callback.message) {
    await editMessageText({
      chatId: String(chatId),
      messageId: callback.message.message_id,
      text: renderOrderMessage(view, `${siteUrl()}/admin/orders/${view.id}`),
      buttons: statusButtons(view),
    });
  }

  await answerCallbackQuery({
    callbackQueryId: callback.id,
    text: STATUS_LABEL[result.order.status],
  });

  return { handled: true, status: result.order.status };
}
