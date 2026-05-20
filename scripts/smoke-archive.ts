#!/usr/bin/env tsx
/**
 * Manual smoke test: verifies Archive.org credentials and item list access.
 * Usage: npx tsx scripts/smoke-archive.ts
 * Requires ARCHIVE_ACCESS_KEY, ARCHIVE_SECRET_KEY, ARCHIVE_EMAIL in .env or environment.
 */
import { readFileSync } from 'node:fs';

// Load .env before importing anything that reads env vars
try {
  const content = readFileSync('.env', 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=#\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  }
} catch {
  // .env not found — env vars must already be set
}

import { searchItems } from '../src/lib/archive/client';
import { env } from '../src/lib/env';

async function main() {
  console.log(`Searching Archive.org for items uploaded by ${env.ARCHIVE_EMAIL} …`);

  const items = await searchItems(
    `uploader:${env.ARCHIVE_EMAIL}`,
    ['identifier', 'title', 'date', 'mediatype'],
    100
  );

  console.log(`\nFound ${items.length} items (showing up to 5):`);
  items.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i + 1}. [${item.identifier}] ${item.title} (${item.date ?? 'no date'})`);
  });

  if (items.length === 0) {
    console.warn('\n⚠️  No items found. Check that ARCHIVE_EMAIL matches your uploader email.');
    process.exit(1);
  }

  console.log('\n✅ Archive.org client is working correctly.');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
