/**
 * Plans JSON-Patch operations for Archive.org metadata updates by inspecting
 * the item's current metadata first.
 *
 * Why this exists — Archive.org enforces RFC 6902 strictly: a `replace` patch
 * on a missing field returns 400 Bad Request. v1 worked around it with a
 * "try replace, retry with add on 400" pattern (see v1 add-before-replace.test.ts).
 * v2 has the current metadata in hand from the pre-read step, so we can plan
 * the right operation up-front without a wasted round-trip.
 *
 * Coercion rules:
 *   - replace + field present (different value) → replace
 *   - replace + field absent → add (would 400 otherwise)
 *   - add + field absent → add
 *   - add + array containing value → drop (no-op)
 *   - add + scalar equal to value → drop (no-op)
 *   - remove + field absent → drop (no-op)
 *   - replace + scalar equal to value → drop (no-op)
 *   - replace + single-element array equal to value → drop (no-op)
 */

import type { ArchiveItem, JsonPatchOperation } from '@/types';

export interface MetadataUpdate {
  field: string;
  value: string;
  operation: 'add' | 'replace' | 'remove';
}

export function planPatches(
  updates: MetadataUpdate[],
  current: ArchiveItem,
): JsonPatchOperation[] {
  const patches: JsonPatchOperation[] = [];

  for (const u of updates) {
    const currentVal = current[u.field];

    if (u.operation === 'replace') {
      if (typeof currentVal === 'string') {
        if (currentVal === u.value) continue;
        patches.push({ op: 'replace', path: `/${u.field}`, value: u.value });
        continue;
      }
      if (Array.isArray(currentVal)) {
        if (currentVal.length === 1 && currentVal[0] === u.value) continue;
        patches.push({ op: 'replace', path: `/${u.field}`, value: u.value });
        continue;
      }
      // Field absent — coerce replace → add so Archive.org doesn't 400.
      patches.push({ op: 'add', path: `/${u.field}`, value: u.value });
      continue;
    }

    if (u.operation === 'add') {
      if (typeof currentVal === 'string' && currentVal === u.value) continue;
      if (Array.isArray(currentVal) && currentVal.includes(u.value)) continue;
      patches.push({ op: 'add', path: `/${u.field}`, value: u.value });
      continue;
    }

    if (u.operation === 'remove') {
      if (currentVal == null) continue;
      if (typeof currentVal === 'string' && currentVal !== u.value) continue;
      if (Array.isArray(currentVal) && !currentVal.includes(u.value)) continue;
      patches.push({ op: 'remove', path: `/${u.field}`, value: u.value });
    }
  }

  return patches;
}
