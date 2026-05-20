import { drainRetryQueue, getRetryQueueStatus } from '@/lib/youtube/retryQueue';

export async function GET() {
  const status = getRetryQueueStatus();
  return Response.json(status);
}

export async function POST() {
  try {
    const summary = await drainRetryQueue();
    console.log(
      `♻️  Retry drain: attempted=${summary.attempted} ok=${summary.succeeded} failed=${summary.failed} ` +
        `remaining=${summary.remaining} quotaHit=${summary.quotaHit} authExpired=${summary.authExpired}`
    );
    return Response.json(summary);
  } catch (error) {
    console.error('Retry drain failed:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Drain failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
