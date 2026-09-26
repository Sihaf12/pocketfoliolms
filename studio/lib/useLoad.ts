'use client';
import { useCallback, useEffect, useState } from 'react';
import { call } from './api';
import { useWorkspace } from '@/components/Workspace';

/** A GET the page depends on, with a reload for after a change. Null path waits. */
export function useLoad<T>(path: string | null) {
  const ws = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    call<T>(path).then((d) => { if (live) { setData(d); setError(null); } }).catch((err: unknown) => {
      if (!live) return;
      ws.handle(err);
      setError(err);
    });
    return () => { live = false; };
    // ws.handle is stable for a given path; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}
