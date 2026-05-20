'use client';

import { useToastStore } from '@/stores/toast';

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={[
            'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg text-sm',
            toast.type === 'error' && 'border-red-200 bg-red-50 text-red-900',
            toast.type === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
            toast.type === 'success' && 'border-green-200 bg-green-50 text-green-900',
            toast.type === 'info' && 'border-zinc-200 bg-white text-zinc-900',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="flex-1">{toast.message}</span>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="shrink-0 font-medium underline hover:no-underline"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-current opacity-50 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
