// Lifted from server/utils.ts — heuristics tuned to the user's title conventions.

export function extractBandFromTitle(title: string): string | null {
  if (!title) return null;

  const patterns = [
    /^([^-]+?)\s*-/, // "Band Name - Song"
    /^([^:]+?):/, // "Band Name: Song"
    /^([^(]+?)\s*\(/, // "Band Name (details)"
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      const bandName = match[1].trim();
      if (bandName.length > 2 && !/^(live|show|concert|performance)$/i.test(bandName)) {
        return bandName;
      }
    }
  }

  return null;
}

export function extractVenueFromTitle(title: string): string | null {
  if (!title) return null;

  const venuePatterns = [
    /live\s+at\s+([^,()]+)/i, // "Live at Venue" — must precede generic "at"
    /at\s+([^,()]+)/i, // "at Venue Name"
    /@\s*([^,()]+)/, // "@ Venue"
  ];

  for (const pattern of venuePatterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      const venue = match[1].trim();
      if (venue.length > 2) {
        return venue;
      }
    }
  }

  return null;
}
