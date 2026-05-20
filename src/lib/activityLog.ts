import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db as defaultDb, type AppDb } from '@/db/client';
import { operationRuns, activityLogEntries } from '@/db/schema';

type OperationType = typeof operationRuns.$inferInsert['operationType'];
type EntryStatus = typeof activityLogEntries.$inferInsert['status'];

export function createOperationRun(
  params: {
    operationType: OperationType;
    totalItems: number;
    parameters?: Record<string, unknown>;
  },
  injectedDb?: AppDb
): string {
  const activeDb = injectedDb ?? defaultDb;
  const id = randomUUID();
  activeDb.insert(operationRuns).values({
    id,
    operationType: params.operationType,
    startedAt: new Date(),
    totalItems: params.totalItems,
    parameters: params.parameters,
  }).run();
  return id;
}

export function finishOperationRun(
  id: string,
  stats: { successfulItems: number; failedItems: number },
  injectedDb?: AppDb
): void {
  const activeDb = injectedDb ?? defaultDb;
  activeDb
    .update(operationRuns)
    .set({
      finishedAt: new Date(),
      successfulItems: stats.successfulItems,
      failedItems: stats.failedItems,
    })
    .where(eq(operationRuns.id, id))
    .run();
}

export function addActivityLogEntry(
  entry: {
    operationRunId: string;
    identifier: string;
    status: EntryStatus;
    message?: string;
    errorCode?: string;
    errorMessage?: string;
  },
  injectedDb?: AppDb
): void {
  const activeDb = injectedDb ?? defaultDb;
  activeDb.insert(activityLogEntries).values(entry).run();
}

export function getEntriesForRun(
  operationRunId: string,
  injectedDb?: AppDb
): (typeof activityLogEntries.$inferSelect)[] {
  const activeDb = injectedDb ?? defaultDb;
  return activeDb
    .select()
    .from(activityLogEntries)
    .where(eq(activityLogEntries.operationRunId, operationRunId))
    .all();
}

export function getOperationRun(
  id: string,
  injectedDb?: AppDb
): typeof operationRuns.$inferSelect | undefined {
  const activeDb = injectedDb ?? defaultDb;
  return activeDb
    .select()
    .from(operationRuns)
    .where(eq(operationRuns.id, id))
    .get();
}
