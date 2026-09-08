import type { OrderingWindow } from '@/lib/checkout-types';
import {
  RESTAURANT_TIME_ZONE,
  type DaySchedule,
  type Weekday,
  type WeeklySchedule,
} from '@/lib/domain';

/** Defined in `lib/` because the checkout screen renders it. Re-exported for callers here. */
export type { OrderingWindow };

/**
 * Opening hours, evaluated in the restaurant's own time zone.
 *
 * The server may run in Frankfurt and the customer may be abroad; "are we open"
 * is only ever a question about Yerevan local time, so every comparison here goes
 * through `Intl` with an explicit zone rather than the host's clock.
 */

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalMoment {
  weekday: Weekday;
  /** Minutes since local midnight. */
  minutes: number;
}

export function toLocalMoment(date: Date, timeZone = RESTAURANT_TIME_ZONE): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  // `hour12: false` renders midnight as "24" in some ICU versions.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return { weekday, minutes: hour * 60 + minute };
}

export function parseTimeOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function previousWeekday(day: Weekday): Weekday {
  return ((day + 6) % 7) as Weekday;
}

function coversMinute(day: DaySchedule, minutes: number): boolean {
  if (day.isClosed) return false;

  const opens = parseTimeOfDay(day.opensAt);
  const closes = parseTimeOfDay(day.closesAt);

  // A window that closes before it opens runs past midnight (e.g. 18:00 → 02:00).
  if (closes > opens) return minutes >= opens && minutes < closes;
  if (closes < opens) return minutes >= opens;
  return false; // zero-length window
}

function spillsIntoNextDay(day: DaySchedule, minutes: number): boolean {
  if (day.isClosed) return false;

  const opens = parseTimeOfDay(day.opensAt);
  const closes = parseTimeOfDay(day.closesAt);

  return closes < opens && minutes < closes;
}

/**
 * Is the restaurant open at this instant?
 *
 * Checks today's window and, separately, yesterday's window if it crosses
 * midnight — at 01:30 the relevant schedule is the previous day's.
 */
export function isOpenAt(
  schedule: WeeklySchedule,
  at: Date = new Date(),
  timeZone = RESTAURANT_TIME_ZONE,
): boolean {
  const { weekday, minutes } = toLocalMoment(at, timeZone);

  if (coversMinute(schedule[weekday], minutes)) return true;

  return spillsIntoNextDay(schedule[previousWeekday(weekday)], minutes);
}

/**
 * Today's window, in the restaurant's own time zone, or `null` when today is a
 * closed day.
 *
 * This is what the storefront prints. It used to print a constant in
 * `lib/restaurant.ts` instead, which meant the hours a customer read and the
 * hours the site actually took orders by were two unrelated values: changing
 * the schedule in the panel opened ordering and left the footer, the hero and
 * the contacts page still promising the old times.
 *
 * Deliberately today's plain window rather than "the window we are inside" — at
 * 01:00 on a schedule that runs to 02:00, a customer reading the footer wants
 * to know when the kitchen opens today, not that yesterday's shift is still on.
 */
export function todaysHours(
  schedule: WeeklySchedule,
  at: Date = new Date(),
  timeZone = RESTAURANT_TIME_ZONE,
): { opensAt: string; closesAt: string } | null {
  const day = schedule[toLocalMoment(at, timeZone).weekday];
  return day.isClosed ? null : { opensAt: day.opensAt, closesAt: day.closesAt };
}

/**
 * The one window every day of the week shares, or `null` if the days differ.
 *
 * Decides whether "Daily 10:00 – 23:00" is a true sentence. The panel can set a
 * different window per day, and the moment it does, that wording stops being
 * one.
 */
export function uniformWeeklyHours(
  schedule: WeeklySchedule,
): { opensAt: string; closesAt: string } | null {
  const days = Object.values(schedule);
  const [first] = days;

  if (!first || first.isClosed) return null;

  const same = days.every(
    (day) => !day.isClosed && day.opensAt === first.opensAt && day.closesAt === first.closesAt,
  );

  return same ? { opensAt: first.opensAt, closesAt: first.closesAt } : null;
}

/**
 * The single question the checkout page asks.
 *
 * Kept separate from `isOpenAt` because "closed for the night" and "we paused
 * orders because the kitchen is swamped" need different wording to the customer.
 */
export function getOrderingWindow(
  schedule: WeeklySchedule,
  isAcceptingOrders: boolean,
  at: Date = new Date(),
  timeZone = RESTAURANT_TIME_ZONE,
): OrderingWindow {
  const isOpen = isOpenAt(schedule, at, timeZone);
  return {
    isOpen,
    isPaused: !isAcceptingOrders,
    canOrder: isOpen && isAcceptingOrders,
  };
}
