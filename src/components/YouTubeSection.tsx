'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLogStore } from '@/stores/log';

interface AuthStatus {
  authenticated: boolean;
  configured: boolean;
  revoked?: boolean;
}

interface CacheStatus {
  videoCount: number;
  lastFetchedAt: string | null;
  channelId: string | null;
}

async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/youtube/status');
  if (!res.ok) throw new Error('Failed to fetch YouTube auth status');
  return res.json() as Promise<AuthStatus>;
}

async function fetchCacheStatus(): Promise<CacheStatus> {
  const res = await fetch('/api/youtube/channel-cache/status');
  if (!res.ok) throw new Error('Failed to fetch cache status');
  return res.json() as Promise<CacheStatus>;
}

async function triggerCacheRefresh(): Promise<{ videoCount: number }> {
  const res = await fetch('/api/youtube/channel-cache/refresh', { method: 'POST' });
  const body = await res.json() as { videoCount?: number; error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Refresh failed');
  return { videoCount: body.videoCount ?? 0 };
}

export function YouTubeSection() {
  const qc = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);
  // Initial state must match between server and client to avoid a hydration
  // mismatch. The effect below reads URL params after mount and sets it then.
  const [authError, setAuthError] = useState<string | null>(null);

  const { data: auth } = useQuery({
    queryKey: ['youtube-auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
  });

  const { data: cache } = useQuery({
    queryKey: ['youtube-cache-status'],
    queryFn: fetchCacheStatus,
    enabled: auth?.authenticated === true,
  });

  const refresh = useMutation({
    mutationFn: triggerCacheRefresh,
    onMutate: () => {
      addLine({ type: 'info', message: 'Refreshing YouTube channel cache…' });
    },
    onSuccess: (data) => {
      addLine({ type: 'success', message: `YouTube cache refreshed — ${data.videoCount} videos cached` });
      void qc.invalidateQueries({ queryKey: ['youtube-cache-status'] });
    },
    onError: (error) => {
      addLine({ type: 'error', message: `Cache refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    },
  });

  useEffect(() => {
    // Reading window.* must happen after mount, not in a useState initializer,
    // or SSR/CSR render outputs disagree (hydration mismatch). The lint
    // rule against setState-in-effect doesn't apply here for the same reason.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('youtube_auth');
    if (result === 'success') {
      void qc.invalidateQueries({ queryKey: ['youtube-auth-status'] });
      window.history.replaceState({}, '', '/');
    } else if (result === 'error') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthError(params.get('reason') ?? 'OAuth failed');
      window.history.replaceState({}, '', '/');
    }
  }, [qc]);

  if (!auth?.configured) return null;

  const needsRevoke = authError?.includes('No refresh token') || authError?.includes('refresh_token');

  return (
    <div className="flex flex-col gap-2">
    {authError && (
      <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        <span className="font-medium">YouTube auth failed: </span>{authError}
        {needsRevoke && (
          <span>
            {' '}—{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="underline hover:no-underline"
            >
              Revoke the app at Google
            </a>
            {' '}then try again.
          </span>
        )}
        <button onClick={() => setAuthError(null)} className="ml-3 opacity-50 hover:opacity-100">×</button>
      </div>
    )}
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-100">YouTube</h2>

          {auth.authenticated ? (
            <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-sm font-medium text-green-300">
              Connected
            </span>
          ) : (
            <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-sm font-medium text-amber-300">
              {auth.revoked ? 'Token revoked — re-authorize' : 'Not connected'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!auth.authenticated && (
            <a
              href="/api/auth/youtube"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              {auth.revoked ? 'Re-authorize YouTube' : 'Connect YouTube'}
            </a>
          )}

          {auth.authenticated && (
            <div className="flex items-center gap-2">
              {cache && (
                <span className="text-sm text-zinc-400">
                  {cache.videoCount > 0
                    ? `${cache.videoCount} videos cached${cache.lastFetchedAt ? ` · ${formatDate(new Date(cache.lastFetchedAt))}` : ''}`
                    : 'Cache empty'}
                </span>
              )}
              <button
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-950 disabled:opacity-50"
              >
                {refresh.isPending ? 'Refreshing…' : 'Refresh cache'}
              </button>
              {refresh.isError && (
                <span className="text-sm text-red-400">{(refresh.error as Error).message}</span>
              )}
              {refresh.isSuccess && (
                <span className="text-sm text-green-400">{refresh.data.videoCount} videos cached</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
