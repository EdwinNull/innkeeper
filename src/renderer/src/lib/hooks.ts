import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { IpcEvents } from '@shared/ipc';
import { on } from './api';

export interface Loadable<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => Promise<void>;
  set: (value: T) => void;
}

/** 异步取数。重复触发时只认最后一次，刷新期间保留旧数据避免闪烁。 */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList = []): Loadable<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const latest = useRef(fn);
  latest.current = fn;

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const value = await latest.current();
      if (mine === ticket.current) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (mine === ticket.current) setError(e as Error);
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      ticket.current++;
    };
    // 依赖由调用方给出
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, set: setData };
}

export function useEvent<K extends keyof IpcEvents>(event: K, fn: (payload: IpcEvents[K]) => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => on(event, (p) => latest.current(p)), [event]);
}

/** 某一类数据变化时重新加载。 */
export function useDataChanged(scopes: IpcEvents['data:changed']['scope'][], reload: () => unknown) {
  useEvent('data:changed', ({ scope }) => {
    if (scopes.includes(scope)) void reload();
  });
}

export function useNow(interval = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T>] {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, set] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => set(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
