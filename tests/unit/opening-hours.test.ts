import { describe, expect, it } from 'vitest';

import { defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { getOrderingWindow, isOpenAt, toLocalMoment } from '@/server/services/opening-hours';

/**
 * Yerevan is UTC+4 year round (Armenia has no daylight saving), so a UTC instant
 * maps to a predictable local time. Times below are written as UTC on purpose —
 * that is what a server in Frankfurt actually holds.
 */
function utc(iso: string): Date {
  return new Date(iso);
}

function schedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
  return { ...defaultWeeklySchedule(), ...overrides };
}

describe('toLocalMoment', () => {
  it('converts a UTC instant to Yerevan weekday and minutes', () => {
    // Wednesday 2026-08-05 08:00 UTC → 12:00 Yerevan.
    expect(toLocalMoment(utc('2026-08-05T08:00:00Z'))).toEqual({ weekday: 3, minutes: 720 });
  });

  it('rolls the weekday over when Yerevan is already tomorrow', () => {
    // Wednesday 21:30 UTC → Thursday 01:30 Yerevan.
    expect(toLocalMoment(utc('2026-08-05T21:30:00Z'))).toEqual({ weekday: 4, minutes: 90 });
  });

  it('reports local midnight as minute zero, not 1440', () => {
    expect(toLocalMoment(utc('2026-08-05T20:00:00Z'))).toEqual({ weekday: 4, minutes: 0 });
  });
});

describe('isOpenAt', () => {
  const tenToEleven = schedule();

  it('is open inside the window', () => {
    // 14:00 Yerevan on a 10:00-23:00 day.
    expect(isOpenAt(tenToEleven, utc('2026-08-05T10:00:00Z'))).toBe(true);
  });

  it('is closed before opening', () => {
    // 09:00 Yerevan.
    expect(isOpenAt(tenToEleven, utc('2026-08-05T05:00:00Z'))).toBe(false);
  });

  it('treats the closing minute as already closed', () => {
    // Exactly 23:00 Yerevan.
    expect(isOpenAt(tenToEleven, utc('2026-08-05T19:00:00Z'))).toBe(false);
  });

  it('is open on the opening minute', () => {
    // Exactly 10:00 Yerevan.
    expect(isOpenAt(tenToEleven, utc('2026-08-05T06:00:00Z'))).toBe(true);
  });

  it('respects a closed day', () => {
    const closedWednesday = schedule({
      3: { isClosed: true, opensAt: '10:00', closesAt: '23:00' },
    });

    expect(isOpenAt(closedWednesday, utc('2026-08-05T10:00:00Z'))).toBe(false);
  });

  it('stays open after midnight when the window crosses it', () => {
    const lateNight = schedule({
      3: { isClosed: false, opensAt: '18:00', closesAt: '02:00' },
      4: { isClosed: true, opensAt: '10:00', closesAt: '23:00' },
    });

    // Thursday 01:30 Yerevan — Thursday itself is closed, but Wednesday's
    // window is still running.
    expect(isOpenAt(lateNight, utc('2026-08-05T21:30:00Z'))).toBe(true);

    // Thursday 02:30 Yerevan — Wednesday's window has ended.
    expect(isOpenAt(lateNight, utc('2026-08-05T22:30:00Z'))).toBe(false);
  });

  it('treats a zero-length window as closed rather than always open', () => {
    const broken = schedule({
      3: { isClosed: false, opensAt: '12:00', closesAt: '12:00' },
    });

    expect(isOpenAt(broken, utc('2026-08-05T08:00:00Z'))).toBe(false);
  });
});

describe('getOrderingWindow', () => {
  it('allows ordering when open and not paused', () => {
    expect(getOrderingWindow(schedule(), true, utc('2026-08-05T10:00:00Z'))).toEqual({
      isOpen: true,
      isPaused: false,
      canOrder: true,
    });
  });

  it('distinguishes "paused by staff" from "closed for the night"', () => {
    const paused = getOrderingWindow(schedule(), false, utc('2026-08-05T10:00:00Z'));
    expect(paused).toEqual({ isOpen: true, isPaused: true, canOrder: false });

    const night = getOrderingWindow(schedule(), true, utc('2026-08-05T00:00:00Z'));
    expect(night).toEqual({ isOpen: false, isPaused: false, canOrder: false });
  });
});
