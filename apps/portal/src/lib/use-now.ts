// useNow — the current time as state, so a view that shows elapsed time stays pure while it
// renders. It ticks every `intervalMs` only while `live` (a run is active); otherwise it is the
// time of the first render.

import { useEffect, useState } from "react";

export function useNow(live: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [live, intervalMs]);
  return now;
}
