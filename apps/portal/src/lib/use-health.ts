import { useEffect, useState } from "react";
import { fetchHealth } from "./api";

export type HealthState = "checking" | "up" | "down";

/** Tracks API liveness for the header status dot and the overview page. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal)
      .then(() => setState("up"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("down");
      });
    return () => controller.abort();
  }, []);

  return state;
}
