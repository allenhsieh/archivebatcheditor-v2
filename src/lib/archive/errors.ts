// Archive.org metadata write API response — documented at https://archive.org/developers/md-write.html
export interface ArchiveApiResult {
  success: boolean;
  error?: string;
  task_id?: number;
  log?: string;
}

export interface ApiError extends Error {
  response?: {
    status: number;
    result?: ArchiveApiResult;
  };
  status?: number;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && 'response' in error;
}

export function isRateLimitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const message =
    'message' in error && typeof error.message === 'string'
      ? error.message.toLowerCase()
      : '';

  let status: unknown;
  if ('status' in error) {
    status = error.status;
  } else if (
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response
  ) {
    status = error.response.status;
  }

  return (
    status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded')
  );
}
