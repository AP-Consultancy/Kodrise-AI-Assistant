import { useCallback, useEffect, useState } from 'react';
import {
  getDiagnostics,
  getSystemStatus,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
  updatePublicConfig,
} from '../services/appApi';
import type {
  CheckStatus,
  FoundationCheckItem,
  FoundationDiagnostics,
  SessionSnapshot,
} from '@shared/ipc/types';

export interface FoundationViewState {
  loading: boolean;
  error: string | null;
  preloadAvailable: boolean;
  ipcConnected: boolean;
  diagnostics: FoundationDiagnostics | null;
  checks: FoundationCheckItem[];
  session: SessionSnapshot | null;
  refresh: () => Promise<void>;
  verifyIpc: () => Promise<void>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  toggleTheme: () => Promise<void>;
}

function buildLocalChecks(args: {
  preloadAvailable: boolean;
  ipcConnected: boolean;
  diagnostics: FoundationDiagnostics | null;
}): FoundationCheckItem[] {
  if (args.diagnostics) {
    return args.diagnostics.checks.map((check) => {
      if (check.id === 'ipc') {
        return {
          ...check,
          status: (args.ipcConnected ? 'pass' : 'fail') as CheckStatus,
          detail: args.ipcConnected ? 'IPC: CONNECTED' : 'IPC health check failed',
        };
      }
      return check;
    });
  }

  return [
    {
      id: 'renderer',
      label: 'Renderer',
      status: 'pass',
      detail: 'React application shell is mounted.',
    },
    {
      id: 'preload',
      label: 'Preload',
      status: args.preloadAvailable ? 'pass' : 'fail',
      detail: args.preloadAvailable
        ? 'window.companyAI is available.'
        : 'window.companyAI was not found.',
    },
    {
      id: 'ipc',
      label: 'IPC',
      status: args.ipcConnected ? 'pass' : 'pending',
      detail: args.ipcConnected ? 'IPC: CONNECTED' : 'Waiting for health check.',
    },
  ];
}

export function useFoundationChecks(): FoundationViewState {
  const preloadAvailable = typeof window !== 'undefined' && typeof window.companyAI !== 'undefined';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ipcConnected, setIpcConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState<FoundationDiagnostics | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!preloadAvailable) {
      setError('window.companyAI is missing — preload/contextBridge failed');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [statusResult, diagnosticsResult] = await Promise.all([
        getSystemStatus(),
        getDiagnostics(),
      ]);

      if (!statusResult.ok) {
        setIpcConnected(false);
        setError(statusResult.error.message);
      } else {
        setIpcConnected(statusResult.data.ipc === 'connected');
      }

      if (diagnosticsResult.ok) {
        setDiagnostics(diagnosticsResult.data);
        setSession(diagnosticsResult.data.session);
      } else {
        setError((current) => current ?? diagnosticsResult.error.message);
      }
    } catch (err) {
      setIpcConnected(false);
      setError(err instanceof Error ? err.message : 'Failed to load foundation diagnostics');
    } finally {
      setLoading(false);
    }
  }, [preloadAvailable]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!preloadAvailable) {
        if (!cancelled) {
          setError('window.companyAI is missing — preload/contextBridge failed');
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setError(null);
      }

      try {
        const [statusResult, diagnosticsResult] = await Promise.all([
          getSystemStatus(),
          getDiagnostics(),
        ]);
        if (cancelled) {
          return;
        }
        if (!statusResult.ok) {
          setIpcConnected(false);
          setError(statusResult.error.message);
        } else {
          setIpcConnected(statusResult.data.ipc === 'connected');
        }
        if (diagnosticsResult.ok) {
          setDiagnostics(diagnosticsResult.data);
          setSession(diagnosticsResult.data.session);
        } else {
          setError((current) => current ?? diagnosticsResult.error.message);
        }
      } catch (err) {
        if (!cancelled) {
          setIpcConnected(false);
          setError(err instanceof Error ? err.message : 'Failed to load foundation diagnostics');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    if (!preloadAvailable) {
      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = window.companyAI.session.onStatusChanged((snapshot) => {
      setSession(snapshot);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [preloadAvailable]);

  const verifyIpc = useCallback(async () => {
    setError(null);
    try {
      const result = await getSystemStatus();
      if (!result.ok) {
        setIpcConnected(false);
        setError(result.error.message);
        return;
      }
      setIpcConnected(result.data.ipc === 'connected');
      await refresh();
    } catch (err) {
      setIpcConnected(false);
      setError(err instanceof Error ? err.message : 'IPC health check failed');
    }
  }, [refresh]);

  const runSession = useCallback(
    async (action: () => Promise<{ ok: true; data: SessionSnapshot } | { ok: false; error: { message: string } }>) => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSession(result.data);
      await refresh();
    },
    [refresh],
  );

  const toggleTheme = useCallback(async () => {
    if (!diagnostics) {
      return;
    }
    const nextTheme = diagnostics.publicConfig.theme === 'dark' ? 'light' : 'dark';
    const result = await updatePublicConfig({ theme: nextTheme });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await refresh();
  }, [diagnostics, refresh]);

  return {
    loading,
    error,
    preloadAvailable,
    ipcConnected,
    diagnostics,
    checks: buildLocalChecks({ preloadAvailable, ipcConnected, diagnostics }),
    session,
    refresh,
    verifyIpc,
    startSession: () => runSession(startSession),
    stopSession: () => runSession(stopSession),
    pauseSession: () => runSession(pauseSession),
    resumeSession: () => runSession(resumeSession),
    toggleTheme,
  };
}
