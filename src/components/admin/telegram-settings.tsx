'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';

import { saveTelegramChatIds, sendTelegramTest } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import { cn } from '@/lib/utils';
import { Card } from './admin-ui';

/**
 * Connecting the kitchen.
 *
 * The test button is the important half. Setting this up means adding a bot to
 * a group and pasting an id nobody can verify by looking at it; without a way
 * to check, the first thing that discovers a wrong id is a customer's order
 * going nowhere.
 */
export function TelegramSettings({
  chatIds,
  readOnly,
  hasToken,
  hasWebhookSecret,
}: {
  chatIds: string[];
  readOnly: boolean;
  hasToken: boolean;
  hasWebhookSecret: boolean;
}) {
  const [value, setValue] = useState(chatIds.join('\n'));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function save() {
    setMessage(null);

    startTransition(async () => {
      const result = await saveTelegramChatIds(value);

      setMessage(
        result.ok
          ? { tone: 'ok', text: ADMIN_TEXT.settings.saved }
          : {
              tone: 'error',
              text:
                result.code === 'INVALID'
                  ? `${ADMIN_TEXT.settings.invalid} ${(result.invalid ?? []).join(', ')}`
                  : ADMIN_TEXT.menu.saveFailed,
            },
      );
    });
  }

  function test() {
    setMessage(null);

    startTransition(async () => {
      const result = await sendTelegramTest();
      setMessage({
        tone: result.ok ? 'ok' : 'error',
        text: (result.results ?? []).join(' · ') || ADMIN_TEXT.menu.saveFailed,
      });
    });
  }

  return (
    <Card className="space-y-4">
      {/* The page holds two things now — the pause switch and this — so each
          card says what it is rather than borrowing the page title. */}
      <h2 className="font-bold">{ADMIN_TEXT.settings.telegramTitle}</h2>

      <div className="space-y-1 text-sm">
        <p className={cn('font-semibold', hasToken ? 'text-lime-400' : 'text-destructive')}>
          {hasToken ? ADMIN_TEXT.settings.ready : ADMIN_TEXT.settings.noToken}
        </p>
        {hasToken && !hasWebhookSecret && (
          <p className="text-destructive text-xs">{ADMIN_TEXT.settings.noWebhookSecret}</p>
        )}
        {chatIds.length === 0 && (
          <p className="text-muted-foreground text-xs">{ADMIN_TEXT.settings.empty}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="chat-ids" className="text-muted-foreground text-sm font-medium">
          {ADMIN_TEXT.settings.chatIdsLabel}
        </label>
        <textarea
          id="chat-ids"
          value={value}
          disabled={readOnly || pending}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          rows={3}
          spellCheck={false}
          className="bg-elevated w-full rounded-xl border border-white/8 p-3 font-mono text-base tabular-nums outline-none focus-visible:border-lime-500/60 disabled:opacity-50 sm:text-sm"
        />
        <p className="text-muted-foreground text-xs">{ADMIN_TEXT.settings.chatIdsHint}</p>
      </div>

      {message && (
        <p
          aria-live="polite"
          className={cn(
            'text-xs font-semibold break-words',
            message.tone === 'ok' ? 'text-lime-400' : 'text-destructive',
          )}
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={readOnly || pending}
          onClick={save}
          className="bg-lime-500 text-primary-foreground hover:bg-lime-400 flex min-h-11 items-center rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-40"
        >
          {ADMIN_TEXT.settings.save}
        </button>

        <button
          type="button"
          disabled={readOnly || pending || !hasToken || chatIds.length === 0}
          onClick={test}
          className="bg-elevated flex min-h-11 items-center gap-2 rounded-xl border border-white/8 px-4 text-sm font-semibold transition-colors hover:bg-white/8 disabled:opacity-40"
        >
          <Send className="size-4" />
          {pending ? ADMIN_TEXT.settings.testing : ADMIN_TEXT.settings.test}
        </button>
      </div>
    </Card>
  );
}
