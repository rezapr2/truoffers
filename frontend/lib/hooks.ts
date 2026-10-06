'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

/** Loads `path` (null = wait) and reloads on demand. Keeps the last data while reloading. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);

  const reload = useCallback(async () => {
    if (!path) return;
    current.current = path;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (current.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (current.current === path) setError(errorMessage(err));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount and when the path changes
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Runs a mutation with a busy flag, an error and an optional success message. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (success) setNotice(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, notice, run, setError, setNotice };
}

/** A value that follows `value` after `ms` without changes (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
