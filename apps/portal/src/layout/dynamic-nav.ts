// Sidebar children computed at runtime (nav-config.tsx → `childrenFrom`). Delivery expands into
// its Overview plus one entry per pipeline stage from GET /api/stages (runtime: assess and understand only), grouped by who runs
// them; while on a Delivery page the entries keep the chosen project and application.

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { jobRunsApi } from "../lib/api/job-runs";
import { AUDIENCE_SHORT, pipelineStages, stageLabel, stagesByAudience } from "../lib/stages";
import { useLoader } from "../lib/use-loader";
import type { NavChildItem, NavChildrenSource } from "./nav-config";

const KEPT_PARAMS = ["project", "app"] as const;

export function useDynamicNavChildren(): Record<NavChildrenSource, NavChildItem[] | undefined> {
  const stages = useLoader("nav/stages", jobRunsApi.stages);
  const { pathname, search } = useLocation();
  const onDelivery = pathname === "/delivery" || pathname.startsWith("/delivery/");

  const suffix = useMemo(() => {
    if (!onDelivery) return "";
    const current = new URLSearchParams(search);
    const kept = new URLSearchParams();
    for (const key of KEPT_PARAMS) {
      const value = current.get(key);
      if (value !== null) kept.set(key, value);
    }
    const text = kept.toString();
    return text === "" ? "" : `?${text}`;
  }, [onDelivery, search]);

  const delivery = useMemo((): NavChildItem[] | undefined => {
    if (stages.data === undefined) return undefined;
    const children: NavChildItem[] = [{ id: "overview", label: "Overview", to: `/delivery${suffix}` }];
    for (const group of stagesByAudience(pipelineStages(stages.data))) {
      for (const stage of group.stages) {
        const badge = group.audience === "portal" ? "planned" : group.audience === "runtime" && !stage.runnable ? "soon" : stage.id === "design" ? "POC" : undefined;
        children.push({
          id: stage.id,
          label: stageLabel(stage.id),
          to: `/delivery/${encodeURIComponent(stage.id)}${suffix}`,
          group: AUDIENCE_SHORT[group.audience],
          ...(badge === undefined ? {} : { badge }),
        });
      }
    }
    return children;
  }, [stages.data, suffix]);

  return useMemo(() => ({ "delivery-stages": delivery }), [delivery]);
}
