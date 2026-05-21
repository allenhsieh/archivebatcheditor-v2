import { enqueueForRetry } from './retryQueue';

type RetryOperationType = Parameters<typeof enqueueForRetry>[0]['operationType'];

interface AbortQueueItem {
  archiveIdentifier: string;
  youtubeVideoId: string;
  payload: Record<string, unknown>;
}

/**
 * Bulk-enqueue items the user expected to process but that we never got to
 * because the batch hit a quota error mid-flight. Used by the three YouTube
 * write routes (recording-dates, tags, descriptions) so each one doesn't
 * re-derive how to flush its remaining work.
 *
 * The caller is responsible for emitting the single "aborted" progress event
 * and breaking the loop — this just handles the queueing side.
 */
export function enqueueRemainingForRetry(
  operationType: RetryOperationType,
  items: AbortQueueItem[],
  reason: string,
): number {
  for (const item of items) {
    enqueueForRetry(
      {
        operationType,
        archiveIdentifier: item.archiveIdentifier,
        youtubeVideoId: item.youtubeVideoId,
        payload: item.payload,
      },
      reason,
    );
  }
  return items.length;
}
