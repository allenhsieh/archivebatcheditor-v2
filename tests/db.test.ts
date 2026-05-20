import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from '@/db/schema';
import {
  createOperationRun,
  finishOperationRun,
  addActivityLogEntry,
  getEntriesForRun,
  getOperationRun,
} from '@/lib/activityLog';
import type { AppDb } from '@/db/client';

let testDb: AppDb;

beforeAll(() => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, {
    migrationsFolder: path.join(process.cwd(), 'src', 'db', 'migrations'),
  });
});

describe('activity log', () => {
  it('creates an operation_run, writes 3 entries, and queries them back', () => {
    const runId = createOperationRun(
      { operationType: 'metadata_update', totalItems: 3 },
      testDb
    );

    expect(runId).toBeTypeOf('string');
    expect(runId).toHaveLength(36); // UUID length

    addActivityLogEntry(
      { operationRunId: runId, identifier: 'item-a', status: 'success' },
      testDb
    );
    addActivityLogEntry(
      {
        operationRunId: runId,
        identifier: 'item-b',
        status: 'failure',
        errorCode: 'BAND_TAG_CONFLICT',
        errorMessage: 'Band tag is locked',
      },
      testDb
    );
    addActivityLogEntry(
      { operationRunId: runId, identifier: 'item-c', status: 'no_change' },
      testDb
    );

    const entries = getEntriesForRun(runId, testDb);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.identifier)).toEqual(['item-a', 'item-b', 'item-c']);
    expect(entries[1].errorCode).toBe('BAND_TAG_CONFLICT');
    expect(entries[2].status).toBe('no_change');
  });

  it('finishes an operation_run and persists stats', () => {
    const runId = createOperationRun(
      { operationType: 'flyer_fanout', totalItems: 5 },
      testDb
    );

    finishOperationRun(runId, { successfulItems: 4, failedItems: 1 }, testDb);

    const run = getOperationRun(runId, testDb);
    expect(run).toBeDefined();
    expect(run!.successfulItems).toBe(4);
    expect(run!.failedItems).toBe(1);
    expect(run!.finishedAt).toBeInstanceOf(Date);
  });
});
