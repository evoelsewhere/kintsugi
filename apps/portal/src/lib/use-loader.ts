// useLoader — loads a resource for a section: data, error, loading and a `slow` flag after a
// few seconds without an answer (so a hanging request says so instead of "Loading…"
// forever), plus reload and live updates. Data belongs to a `key` (e.g. the project
// id): when the key changes, the old data is not shown for the new key. `live` names the
// topics the data comes from: it is read again, keeping what is shown, when the server says one
// changed (lib/live.ts). `refresh` is a timer for data that ages by itself (a worker not seen
// for a while changes nothing in the database); it pauses while the tab is hidden.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./format";
import { type LiveSpec, subscribeLive } from "./live";

export interface Loader<T> {
  data: T | undefined;
  error: string | null;
  /** True until the first answer for the current key. */
  loading: boolean;
  /** True when the first answer takes longer than SLOW_MS. */
  slow: boolean;
  reload: () => Promise<void>;
}

const SLOW_MS = 8000;

interface State<T> {
  key: string;
  data?: T;
  error: string | null;
  slow: boolean;
  settled: boolean;
}

export interface LoaderOptions<T> {
  /** The topics the data comes from: it is read again when one of them changes. */
  live?: readonly LiveSpec[];
  /** Milliseconds until the next refresh given the current data, or false for none; only for data that ages by itself. */
  refresh?: (data: T) => number | false;
}

export function useLoader<T>(key: string, load: () => Promise<T>, options: LoaderOptions<T> = {}): Loader<T> {
  const [state, setState] = useState<State<T>>({ key, error: null, slow: false, settled: false });
  const loadRef = useRef(load);
  const keyRef = useRef(key);
  const generation = useRef(0);
  useEffect(() => {
    loadRef.current = load;
    keyRef.current = key;
  });

  const reload = useCallback(async (): Promise<void> => {
    const id = ++generation.current;
    const forKey = keyRef.current;
    const slowTimer = setTimeout(() => {
      if (id === generation.current) setState((current) => (current.key === forKey && current.settled ? current : { key: forKey, error: null, slow: true, settled: false }));
    }, SLOW_MS);
    try {
      const data = await loadRef.current();
      if (id === generation.current) setState({ key: forKey, data, error: null, slow: false, settled: true });
    } catch (failure) {
      if (id === generation.current) {
        setState((current) => (current.key === forKey ? { ...current, error: errorText(failure), slow: false, settled: true } : { key: forKey, error: errorText(failure), slow: false, settled: true }));
      }
    } finally {
      clearTimeout(slowTimer);
    }
  }, []);

  useEffect(() => {
    // reload() sets state only after awaiting the request, never synchronously.
    void reload();
  }, [key, reload]);

  const liveKey = options.live?.join(",") ?? "";
  useEffect(() => {
    if (liveKey === "") return;
    return subscribeLive(liveKey.split(",") as LiveSpec[], () => void reload());
  }, [liveKey, reload]);

  const current = state.key === key;
  const data = current ? state.data : undefined;
  const interval = data === undefined || options.refresh === undefined ? false : options.refresh(data);
  useEffect(() => {
    if (interval === false) return;
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, interval);
    return () => clearInterval(timer);
  }, [interval, reload]);

  return {
    data,
    error: current ? state.error : null,
    loading: !current || !state.settled,
    slow: current && state.slow,
    reload,
  };
}
