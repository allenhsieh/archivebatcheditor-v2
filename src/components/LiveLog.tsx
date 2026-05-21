'use client';

import { useEffect, useRef } from 'react';
import { useLogStore } from '@/stores/log';
import type { LogLine } from '@/stores/log';

const TYPE_CONFIG: Record<LogLine['type'], { dot: string; text: string; label: string }> = {
  success:   { dot: 'bg-green-500',  text: 'text-green-800',  label: '✅' },
  error:     { dot: 'bg-red-500',    text: 'text-red-300',    label: '❌' },
  info:      { dot: 'bg-blue-400',   text: 'text-zinc-300',   label: 'ℹ️' },
  skipped:   { dot: 'bg-zinc-400',   text: 'text-zinc-400',   label: '⏭' },
  no_change: { dot: 'bg-zinc-300',   text: 'text-zinc-400',   label: '—' },
};

export function LiveLog() {
  const { lines, clear } = useLogStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-100">
          Session Log <span className="font-normal text-zinc-500">({lines.length})</span>
        </h2>
        <button
          onClick={clear}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Clear
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md bg-zinc-950 p-2 font-mono text-sm">
        {lines.map((line) => {
          const cfg = TYPE_CONFIG[line.type];
          return (
            <div key={line.id} className="flex items-start gap-2 py-0.5">
              <span className="shrink-0 text-zinc-500 tabular-nums">
                {line.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`shrink-0 ${cfg.text}`}>{cfg.label}</span>
              <span className={`flex-1 ${cfg.text}`}>
                {line.message}
                {line.identifier && (
                  <span className="ml-1 text-zinc-500">({line.identifier})</span>
                )}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
