// Lifted verbatim from server/utils.ts — these handle 7+ date formats including
// the user's actual filename convention (DD.MM.YY). Behavior is intentional;
// see LIFT_LIST.md for the DD.MM.YY vs MM.DD.YY quirk note.

export function standardizeDate(dateStr: string): string {
  if (!dateStr) return dateStr;

  // MM/DD/YY (e.g., "03/12/14" -> "2014-03-12")
  const mmddyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mmddyyMatch) {
    const [, month, day, year] = mmddyyMatch;
    return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // MM/DD/YYYY (e.g., "03/12/2014" -> "2014-03-12")
  const mmddyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyyMatch) {
    const [, month, day, year] = mmddyyyyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD.MM.YY European format (e.g., "12.03.14" -> "2014-03-12")
  const ddmmyyMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (ddmmyyMatch) {
    const [, day, month, year] = ddmmyyMatch;
    return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD.MM.YYYY European format (e.g., "12.03.2014" -> "2014-03-12")
  const ddmmyyyyMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // ISO timestamp (e.g., "2016-02-28T00:00:00Z" -> "2016-02-28")
  const isoDateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  // YYYY-MM-DD (already correct)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Year only (e.g., "2023" -> "2023-01-01")
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }

  console.warn(`Unrecognized date format: "${dateStr}", returning as-is`);
  return dateStr;
}

export function extractDateFromTitle(title: string): string | null {
  if (!title) return null;

  const datePatterns = [
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\d{1,2}\.\d{1,2}\.\d{2,4})/,
    /(\d{4})/,
  ];

  for (const pattern of datePatterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      return standardizeDate(match[1]);
    }
  }

  return null;
}
