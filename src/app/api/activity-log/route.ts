import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, and, gte, SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { operationRuns, activityLogEntries } from '@/db/schema';

const VALID_OP_TYPES = [
  'metadata_update',
  'flyer_fanout',
  'youtube_recording_date',
  'youtube_tags',
  'youtube_description',
] as const;

type OperationType = (typeof VALID_OP_TYPES)[number];

function isValidOpType(s: string): s is OperationType {
  return (VALID_OP_TYPES as readonly string[]).includes(s);
}

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

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const opTypeParam = searchParams.get('operationType');
  const sinceParam = searchParams.get('since');

  const conditions: SQL[] = [];
  if (opTypeParam && isValidOpType(opTypeParam)) {
    conditions.push(eq(operationRuns.operationType, opTypeParam));
  }
  if (sinceParam) {
    const sinceDate = new Date(sinceParam);
    if (!isNaN(sinceDate.getTime())) {
      conditions.push(gte(operationRuns.startedAt, sinceDate));
    }
  }

  const runs = db
    .select()
    .from(operationRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(operationRuns.startedAt))
    .limit(limit)
    .all();

  return NextResponse.json({ runs });
}
