import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from '@/lib/domain';
import { pickLocalized } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import type { OrderView } from '@/lib/order-types';
import { formatArmenianPhone } from '@/lib/phone';
import type { InlineButton } from './client';

/**
 * The kitchen ticket.
 *
 * Pure — an order in, a string and some buttons out — because this is the part
 * worth testing and the part that must never depend on a network. It is also
 * the part a cook reads at speed with their hands full, so the order of the
 * lines is the order of the questions they ask: what is it, what is in it, what
 * does it cost, where is it going, who do I ring.
 *
 * Russian, matching the admin panel. The customer's own words — their name,
 * their address, their note — are passed through exactly as they typed them,
 * in whatever language that was.
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  // Present for completeness only. A ticket is queued when an online order is
  // paid, by which point it is `NEW`, so the kitchen never sees this word.
  AWAITING_PAYMENT: 'Ожидает оплаты',
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  PREPARING: 'Готовится',
  READY: 'Готов',
  DELIVERING: 'В пути',
  COMPLETED: 'Выдан',
  CANCELLED: 'Отменён',
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Наличными',
  CARD_ON_DELIVERY: 'Картой курьеру',
  ONLINE: 'Онлайн',
};

/**
 * Telegram parses a small subset of HTML, so anything the customer typed has
 * to be escaped before it goes near it. A name containing `<` would otherwise
 * either break the message or, worse, be interpreted as markup.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderOrderMessage(order: OrderView, adminUrl: string): string {
  const lines: string[] = [];

  const heading = order.type === 'DELIVERY' ? '🛵 Доставка' : '🏪 Самовывоз';
  lines.push(`<b>${heading} · ${escapeHtml(order.publicCode)}</b>`);
  lines.push(`Статус: ${STATUS_LABEL[order.status]}`);
  lines.push('');

  for (const item of order.items) {
    const options = item.options.map((option) => pickLocalized(option.name, 'ru')).join(', ');
    lines.push(
      `${item.quantity} × ${escapeHtml(pickLocalized(item.name, 'ru'))}` +
        (options ? ` <i>(${escapeHtml(options)})</i>` : '') +
        ` — ${formatAmd(item.lineTotal, 'ru')}`,
    );
  }

  lines.push('');
  lines.push(`Сумма: ${formatAmd(order.subtotal, 'ru')}`);
  if (order.type === 'DELIVERY') {
    lines.push(`Доставка: ${formatAmd(order.deliveryFee, 'ru')}`);
  }
  lines.push(`<b>Итого: ${formatAmd(order.total, 'ru')}</b>`);
  lines.push(`Оплата: ${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}`);
  lines.push(`Готовность: ~${order.etaMinutes} мин`);
  lines.push('');

  lines.push(`Клиент: ${escapeHtml(order.customerName)}`);
  lines.push(`Телефон: ${escapeHtml(formatArmenianPhone(order.phone))}`);

  if (order.type === 'DELIVERY') {
    lines.push(`Адрес: ${escapeHtml(order.address ?? '—')}`);
    if (order.landmark) lines.push(`Ориентир: ${escapeHtml(order.landmark)}`);
    if (order.lat !== null && order.lng !== null) {
      // A plain maps link rather than a Telegram location message: it opens in
      // whatever the courier already uses for navigation.
      lines.push(
        `Карта: https://www.openstreetmap.org/?mlat=${order.lat}&mlon=${order.lng}#map=18/${order.lat}/${order.lng}`,
      );
    }
  }

  if (order.notes) {
    lines.push('');
    lines.push(`<b>Комментарий:</b> ${escapeHtml(order.notes)}`);
  }

  lines.push('');
  lines.push(`Открыть в панели: ${adminUrl}`);

  return lines.join('\n');
}

/**
 * One button per move the order can actually make from where it is.
 *
 * Read straight off the domain's transition table — the same one the panel
 * reads and the same one `updateOrderStatus` enforces. A terminal order gets no
 * buttons at all, which is how the message stops offering anything once the
 * food has been handed over.
 *
 * `callback_data` is capped at 64 bytes by Telegram, so it carries the public
 * code rather than the order's UUID. That is not a secret and not a credential:
 * the webhook is authenticated by its secret header, and the chat is checked
 * against the configured list before anything is acted on.
 */
export function statusButtons(order: {
  publicCode: string;
  status: OrderStatus;
}): InlineButton[][] {
  const next = ORDER_STATUS_TRANSITIONS[order.status];
  if (next.length === 0) return [];

  const buttons = next.map((to) => ({
    text: to === 'CANCELLED' ? `✖️ ${STATUS_LABEL[to]}` : `✅ ${STATUS_LABEL[to]}`,
    callback_data: `st:${order.publicCode}:${to}`,
  }));

  // Cancelling sits on its own row, so a thumb aiming for "confirm" cannot
  // land on it.
  const advance = buttons.filter((button) => !button.callback_data.endsWith('CANCELLED'));
  const cancel = buttons.filter((button) => button.callback_data.endsWith('CANCELLED'));

  return [...(advance.length > 0 ? [advance] : []), ...(cancel.length > 0 ? [cancel] : [])];
}

export interface ParsedCallback {
  publicCode: string;
  to: OrderStatus;
}

export function parseCallbackData(data: string): ParsedCallback | null {
  const parts = data.split(':');
  if (parts.length !== 3 || parts[0] !== 'st') return null;

  const [, publicCode, to] = parts;
  if (!(to in ORDER_STATUS_TRANSITIONS)) return null;

  return { publicCode, to: to as OrderStatus };
}

export { STATUS_LABEL };
