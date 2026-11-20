"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, errorMessage } from "./api";

export type ResourceState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Loads one admin API resource, exposing loading/error/ready states and a reload. `path` changes trigger a reload. */
export function useAdminResource<T>(path: string): { state: ResourceState<T>; reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    adminFetch<T>(path, { signal: controller.signal }).then(
      (data) => setState({ status: "ready", data }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
