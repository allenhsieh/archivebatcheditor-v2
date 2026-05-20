export interface SSEStartEvent {
  type: 'start';
  total: number;
  operationId: string;
}

export interface SSEProgressEvent {
  type: 'progress';
  current: number;
  total: number;
  identifier: string;
  status: 'processing' | 'completed' | 'error' | 'no_change';
  error?: string;
  message?: string;
}

export interface SSECompleteEvent {
  type: 'complete';
  total: number;
  successful: number;
  failed: number;
  noChange: number;
  results: Array<{ identifier: string; success: boolean; noChange?: boolean; error?: string }>;
  dryRun?: boolean;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
}

export type SSEEvent = SSEStartEvent | SSEProgressEvent | SSECompleteEvent | SSEErrorEvent;

export function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function encodeSSEEvent(data: SSEEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export function createSSEStream(
  handler: (send: (event: SSEEvent) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: SSEEvent) {
        controller.enqueue(encodeSSEEvent(event));
      }
      try {
        await handler(send);
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });
}
