import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { operationRuns, activityLogEntries } from '@/db/schema';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const runId = searchParams.get('runId');

  if (runId) {
    const entries = db
      .select()
      .from(activityLogEntries)
      .where(eq(activityLogEntries.operationRunId, runId))
      .all();
    return NextResponse.json({ entries });
  }

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const runs = db
    .select()
    .from(operationRuns)
    .orderBy(desc(operationRuns.startedAt))
    .limit(limit)
    .all();

  return NextResponse.json({ runs });
}
