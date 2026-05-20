'use client';

import { useState, useCallback, useRef } from 'react';
import type { SSEEvent } from '@/lib/sse';

type SSEStatus = 'idle' | 'streaming' | 'done' | 'error';

interface UseSSEStreamReturn {
  status: SSEStatus;
  startStream: (url: string, body: unknown) => void;
  cancel: () => void;
}

// Lifted buffer-parsing pattern from v1 MetadataEditor.tsx
export function useSSEStream(onEvent: (event: SSEEvent) => void): UseSSEStreamReturn {
  const [status, setStatus] = useState<SSEStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const startStream = useCallback(
    async (url: string, body: FormData | unknown) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('streaming');

      const isFormData = body instanceof FormData;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: isFormData ? {} : { 'Content-Type': 'application/json' },
          body: isFormData ? body : JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Request failed: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6)) as SSEEvent;
                onEvent(data);
              } catch {
                // malformed event — skip
              }
            }
          }
        }

        setStatus('done');
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setStatus('error');
      }
    },
    [onEvent]
  );

  return { status, startStream, cancel };
}
