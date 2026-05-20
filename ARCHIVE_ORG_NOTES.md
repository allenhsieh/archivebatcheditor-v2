# Archive.org Integration Notes

Domain knowledge collected from building v1. Consult before touching the Archive.org integration layer.

## Auth

`Authorization: LOW <ACCESS_KEY>:<SECRET_KEY>` on every API call. Keys are obtained from [archive.org/account/s3.php](https://archive.org/account/s3.php). Always use HTTPS.

## Endpoints we use

### Search (read)
- `GET https://archive.org/advancedsearch.php?q=<query>&fl=<fields>&rows=<n>&output=json&sort=addeddate+desc`
- Returns `response.docs[]` and `response.numFound`
- Fields we always request: `identifier, title, creator, description, date, mediatype, collection, subject, uploader, youtube`

### User's items list
- Same search endpoint with `q=uploader:<email>`
- Returns up to `rows` items; v1 used `rows=1000` which is the soft cap

### Item metadata (read)
- `GET https://archive.org/metadata/<identifier>`
- Returns full metadata + files list

### Item metadata (write)
- `POST https://archive.org/metadata/<identifier>` with `Authorization: LOW ...`
- Body (URL-encoded form): `-target=metadata&-patch=<JSON-Patch-RFC6902>`
- The `-patch` field is **double-encoded**: JSON-encoded, then percent-encoded
- Path in the patch is relative — `/creator` not `/metadata/creator`
- **Multi-target writes via `-changes` exist but ARE BANNED** — they're atomic (all-or-nothing rollback), which destroys partial-success behavior. See CLAUDE.md hard rule #1.

### File upload (IA-S3)
- `PUT https://s3.us.archive.org/<identifier>/<filename>`
- Headers:
  - `Authorization: LOW ...`
  - `x-amz-auto-make-bucket: 1` (creates the item if it doesn't exist)
  - `x-archive-meta-<field>: <value>` (one header per metadata field, sets metadata at upload time)
  - `x-archive-queue-derive: 0` (suppress derivative generation — see "Derivatives" section)
  - `X-Accept-Reduced-Priority: 1` (queue at lower priority instead of 429'ing)
- Body: raw file bytes (NOT multipart/form-data)

### Pre-flight upload check
- `GET https://s3.us.archive.org/?check_limit=1&accesskey=<key>&bucket=<identifier>`
- Returns whether the bucket can accept uploads right now. Use before bulk uploads to fail fast instead of getting 503 SlowDown mid-stream.

## Derivatives — the `_rules.conf` story

v1 uploaded a `_rules.conf` file containing `CAT.ALL` alongside each flyer to suppress derivative generation. This was the documented approach at the time but has problems:

- `CAT.ALL` was narrowed at some point to mean the same as `CAT.lossy` (only suppresses lossy derivatives, not all)
- Forum reports say derivatives are sometimes generated despite the rule
- Requires a second PUT request per upload

**Rebuild approach**: use `x-archive-queue-derive: 0` header on the upload PUT. Single request, documented as a first-class option, no ambiguity about what it suppresses.

**Verification step (do this once before relying on it)**: upload a flyer with the header, wait 60s, check `https://archive.org/metadata/<identifier>` — confirm no `_thumb.jpg`, no derivative formats appear in the files list. If derivatives DO appear, fall back to the v1 approach (also upload `_rules.conf` with `CAT.ALL`) and document the discrepancy.

## The flyer fanout flow

The ONLY upload feature in this app. Workflow:

1. User selects N items
2. User picks ONE image file (10MB max, JPEG/PNG/GIF/WebP)
3. App PUTs the same file to each of the N items' buckets, sequentially
4. Filename is standardized via `generateFlyerFilename()` (see LIFT_LIST.md)
5. Per-item progress streamed back via SSE
6. Per-item failures collected and shown in the activity log

The user explicitly does NOT want:
- Multiple files at once
- Drag-drop folder upload
- Old-version retention (`x-archive-keep-old-version` is not set)
- Size hint header (`x-archive-size-hint` is not set — only relevant for multi-GB items)

## Filename convention

`{YYYY-MM-DD}-flyer_itemimage.{ext}` where the date is extracted from (in order):
1. The item's explicit `date` metadata field
2. Date pattern in the title
3. Date pattern in the identifier
4. Year extracted from identifier
5. Current year (fallback)

The full implementation is `generateFlyerFilename` in v1's `server/utils.ts:268` — port verbatim. See [LIFT_LIST.md](./LIFT_LIST.md).

## Date format zoo

The user's collection has dates in many formats. `standardizeDate` in v1's `server/utils.ts:18` handles:

- `MM/DD/YY` (e.g., `03/12/14` → `2014-03-12`)
- `MM/DD/YYYY` (e.g., `03/12/2014` → `2014-03-12`)
- `DD.MM.YY` (e.g., `12.03.14` → `2014-03-12`) — used in user's filenames
- `DD.MM.YYYY` (e.g., `12.03.2014` → `2014-03-12`)
- ISO `YYYY-MM-DDTHH:MM:SSZ` → `YYYY-MM-DD`
- `YYYY-MM-DD` (already canonical)
- `YYYY` (year only → `YYYY-01-01`)

Port verbatim. The user's collection depends on every one of these formats being recognized.

## Error taxonomy

### `400 "no changes to _meta.xml"` → SUCCESS

When your patch doesn't actually change anything (the value already matched), Archive.org returns a 400 with this error string. **This is success, not failure.** v1 was treating it as failure and retrying 3 times needlessly.

In the retry wrapper:

```ts
const archiveError = isApiError(error) ? (error.response?.result?.error ?? '') : ''
if (archiveError === 'no changes to _meta.xml') {
  console.log(`✅ ${context}: no changes needed (already up to date)`)
  return { success: true, noChanges: true }
}
```

Log status as `no_change` in the activity log (distinct from `success` so the UI can show "skipped because already correct").

### `429 Too Many Requests` → rare with reduced-priority header

If you set `X-Accept-Reduced-Priority: 1` on every batch write, 429s should be rare. If they happen, back off and retry with exponential delay. Do NOT add concurrency.

### `503 SlowDown` → task queue overloaded

Archive.org's task queue (which processes PUTs and DELETEs) is full. Back off, retry. Pre-flight check with `?check_limit=1` reduces these.

### Per-item rejections (the common case)

These come back as 400s with various error strings:
- `"<field> is required"` — schema violation
- `"value already exists"` — duplicate constraint
- `"invalid value"` — schema/format violation
- Various unhelpful generic messages

Log per-item, surface to user in activity log, do NOT abort the rest of the batch. **Partial success is the common case.**

### Auth failures

`401`/`403` from Archive.org typically means bad LOW key. Surface to user as "check your `ARCHIVE_ACCESS_KEY` / `ARCHIVE_SECRET_KEY`."

## Type guards (port from v1)

```ts
export interface ArchiveApiResult {
  success: boolean
  error?: string         // present on failure
  task_id?: number       // present on success
  log?: string
}

export interface ApiError extends Error {
  response?: {
    status: number
    result?: ArchiveApiResult
  }
  status?: number
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'response' in error
}
```

Use these everywhere. NO `as any`, NO `as` casts.

## What we DON'T need

- Item Engagement / Views API
- Reviews API
- OCR API
- PDF API
- Changes API (TanStack Query refetch is fine)
- Tasks API (could surface derivation status but not currently needed)

## Reference URLs

- [API portal](https://archive.org/developers/index.html)
- [Metadata Write API](https://archive.org/developers/md-write.html)
- [IA-S3 upload API](https://archive.org/developers/ias3.html)
- [Derivative formats](https://archive.org/help/derivatives.php)
- [internetarchive Python lib / `ia` CLI](https://archive.org/developers/internetarchive/) — recommended by Archive.org but not used here (we stay all-Node)
