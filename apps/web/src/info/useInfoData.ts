import { SectionAvailability } from "./SectionAvailability";
import { useEffect, useState, useContext } from "react";
import { apiGet, ApiError } from "../lib/api";

export type InfoDataState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * Fetches a panel's content, distinguishing "this place has none" from "the lookup failed".
 *
 * Panels are opened by a click and closed just as fast, so an in-flight request is aborted
 * rather than left to resolve into a component nobody is looking at.
 */
export function useInfoData<T>(
  path: string | null,
  query: Record<string, string | number | undefined | null>
): InfoDataState<T> {
  const [state, setState] = useState<InfoDataState<T>>({ status: "loading" });
  const report = useContext(SectionAvailability);
  useEffect(() => {
    report?.({ empty: state.status === "empty", error: state.status === "error" });
  }, [state.status, report]);
  const key = `${path}|${JSON.stringify(query)}`;

  useEffect(() => {
    if (!path) {
      setState({ status: "empty" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });

    apiGet<T>(path, { query, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: "empty" });
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Načtení se nepovedlo"
        });
      });

    return () => controller.abort();
    // `key` stands in for path + query: panels rebuild the query object on every render, so
    // depending on it directly would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
