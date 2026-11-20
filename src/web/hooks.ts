import { useEffect, useState } from "react";
import type { RegionId, RegionView } from "../domain/index.ts";
import { errorMessage, type Api } from "./api.ts";

export const REFRESH_MS = 60_000;

/** Ticks so freshness ("12m ago", Stale) moves on between refreshes. */
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

type Loaded = { readonly regionId: RegionId; readonly view: RegionView | null; readonly error: string | null };

/**
 * The Region View for `regionId`, refetched every REFRESH_MS. A failed refetch
 * keeps the last view and reports the error alongside it.
 */
export function useRegionView(api: Api, regionId: RegionId | null): Omit<Loaded, "regionId"> {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (regionId === null) return;
    let cancelled = false;
    const load = () => {
      api.regionView(regionId).then(
        (view) => {
          if (!cancelled) setLoaded({ regionId, view, error: null });
        },
        (e: unknown) => {
          if (cancelled) return;
          const error = e instanceof Error ? e.message : String(e);
          setLoaded((prev) => ({
            regionId,
            view: prev?.regionId === regionId ? prev.view : null,
            error,
          }));
        },
      );
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api, regionId]);
  return loaded?.regionId === regionId ? loaded : { view: null, error: null };
}

export type Action = {
  readonly pending: boolean;
  readonly error: string | null;
  /** Runs `call`, tracking pending; a failure shows the server's message as `error`. */
  readonly run: <T>(call: () => Promise<T>, onDone: (value: T) => void) => void;
  /** Reports a problem found before any call, such as mismatched passwords. */
  readonly fail: (error: string) => void;
};

/** The pending and error state of a form submit or button press. */
export function useAction(): Action {
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  return {
    ...state,
    run: (call, onDone) => {
      setState({ pending: true, error: null });
      call().then(
        (value) => {
          setState({ pending: false, error: null });
          onDone(value);
        },
        (e: unknown) => {
          setState({ pending: false, error: errorMessage(e) });
        },
      );
    },
    fail: (error) => {
      setState({ pending: false, error });
    },
  };
}
