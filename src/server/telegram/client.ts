import { botToken, TELEGRAM_API, TELEGRAM_TIMEOUT_MS } from './config';

/**
 * The Bot API, as much of it as this system uses.
 *
 * Four calls, hand-rolled over `fetch`. A client library would bring a
 * dependency and an update cadence for something that is four POSTs of JSON.
 *
 * Nothing here throws. Every method answers a discriminated result, because
 * every caller of this module is in a position where an exception would be
 * wrong: the order is already placed, the customer has already been told, and
 * an unreachable kitchen is a thing to record and retry rather than a thing to
 * crash on. `ok: false` carries enough to write into `notifications.lastError`
 * and to decide whether trying again could ever help.
 */

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type TelegramResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /**
       * `true` when the same request could succeed later — a timeout, a network
       * failure, a 429 or a 5xx. `false` for a request Telegram will refuse
       * however often it is repeated, such as a chat the bot was removed from.
       */
      retryable: boolean;
      error: string;
    };

async function call<T>(method: string, body: unknown): Promise<TelegramResult<T>> {
  const token = botToken();
  if (!token) return { ok: false, retryable: false, error: 'Telegram is not configured' };

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // Without this a hung Telegram would hold the function open until the
      // platform kills it, and on a serverless deploy that is billed time.
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: T; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        // 4xx other than rate limiting is our mistake or a removed chat;
        // repeating it changes nothing.
        retryable: response.status === 429 || response.status >= 500,
        error: payload?.description ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true, value: payload.result as T };
  } catch (error) {
    // Timeouts, DNS, TLS, a laptop losing wifi mid-send. All worth another go.
    return {
      ok: false,
      retryable: true,
      error: error instanceof Error ? error.message : 'network error',
    };
  }
}

export interface SentMessage {
  message_id: number;
}

export function sendMessage(args: {
  chatId: string;
  text: string;
  buttons?: InlineButton[][];
}): Promise<TelegramResult<SentMessage>> {
  return call<SentMessage>('sendMessage', {
    chat_id: args.chatId,
    text: args.text,
    parse_mode: 'HTML',
    // The order text carries an admin link; a preview card for it would push
    // the order itself off the screen.
    link_preview_options: { is_disabled: true },
    ...(args.buttons ? { reply_markup: { inline_keyboard: args.buttons } } : {}),
  });
}

export function editMessageText(args: {
  chatId: string;
  messageId: number;
  text: string;
  buttons?: InlineButton[][];
}): Promise<TelegramResult<unknown>> {
  return call('editMessageText', {
    chat_id: args.chatId,
    message_id: args.messageId,
    text: args.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: args.buttons ?? [] },
  });
}

/**
 * Telegram spins the button until this is answered. Answering is not optional
 * even when nothing happened — an unanswered callback looks like a frozen app
 * to the person who pressed it.
 */
export function answerCallbackQuery(args: {
  callbackQueryId: string;
  text?: string;
}): Promise<TelegramResult<unknown>> {
  return call('answerCallbackQuery', {
    callback_query_id: args.callbackQueryId,
    ...(args.text ? { text: args.text } : {}),
  });
}
