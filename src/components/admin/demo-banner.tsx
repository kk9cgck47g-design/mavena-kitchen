'use client';

import { Info, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { ADMIN_TEXT } from '@/app/admin/strings';
import { useDemoAdmin } from '@/stores/demo-admin';

/**
 * Says plainly what the preview is, and offers the one control that makes the
 * claim checkable.
 *
 * The reset is not decoration. "Nothing is saved" is easy to write and hard to
 * believe; a button that puts the kitchen back the way it was, instantly and
 * without a round trip, is the demonstration.
 */
export function DemoBanner() {
  const reset = useDemoAdmin((s) => s.reset);
  const changes = useDemoAdmin((s) => s.changes);
  const [justReset, setJustReset] = useState(false);

  const touched = Object.keys(changes).length > 0;

  /*
    Stacked below `sm`. Wrapping a fixed-width button beside a paragraph works
    down to about 400px and then collapses: at 320 the button keeps its width,
    the text is squeezed to one word per line, and the two overlap.
  */
  return (
    <div className="border-lime-500/25 bg-lime-500/8 flex flex-col gap-3 rounded-2xl border p-4 text-sm sm:flex-row sm:items-start">
      <Info className="text-lime-400 mt-0.5 hidden size-4 shrink-0 sm:block" />

      <div className="min-w-0 flex-1">
        <p className="text-lime-400 flex items-center gap-2 font-bold">
          <Info className="size-4 shrink-0 sm:hidden" />
          {ADMIN_TEXT.demo.banner}
        </p>
        <p className="text-muted-foreground mt-1 leading-relaxed">{ADMIN_TEXT.demo.explain}</p>
        {justReset && (
          <p aria-live="polite" className="text-lime-400 mt-2 text-xs font-semibold">
            {ADMIN_TEXT.demo.resetDone}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!touched}
        onClick={() => {
          reset();
          setJustReset(true);
        }}
        className="bg-elevated flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/8 px-3.5 text-xs font-semibold transition-colors hover:bg-white/8 disabled:opacity-40"
      >
        <RotateCcw className="size-3.5" />
        {ADMIN_TEXT.demo.reset}
      </button>
    </div>
  );
}
