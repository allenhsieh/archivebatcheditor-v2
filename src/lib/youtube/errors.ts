// Lifted verbatim from v1 server/utils.ts:168-188

export function isYouTubeAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('invalid_grant') || msg.includes('token has been expired or revoked');
}

export function isYouTubeQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const status = (error as unknown as Record<string, unknown>).status;
  return (
    status === 403 ||
    msg.includes('quota') ||
    msg.includes('quota_exhausted') ||
    msg.includes('exceeded your quota')
  );
}
