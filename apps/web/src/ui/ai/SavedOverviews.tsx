import { useEffect, useRef, useState } from "react";
import { isOverviewResult, type OverviewRequest, type OverviewResult } from "@mapos/layer-sdk";
import { apiGet, apiSendWithMetadata } from "../../lib/api";
import { Button, InlineNotice } from "../kit";
import { OverviewView } from "./OverviewView";

type SavedRow = { id: string; title: string; createdAt: string };
/** Explicitly opened list, no startup query and no generation when reading saved work. */
export function SavedOverviews() {
  const listRun = useRef<AbortController | null>(null);
  const detailRun = useRef<AbortController | null>(null);
  const selectedId = useRef<string | null>(null);
  const mutations = useRef(new Map<string, AbortController>());
  const deleted = useRef(new Set<string>());
  const [opened, setOpened] = useState(false);
  const [rows, setRows] = useState<SavedRow[] | null>(null);
  const [removing, setRemoving] = useState<string[]>([]);
  const [selected, setSelected] = useState<{
    id: string;
    recipe: OverviewRequest;
    result: OverviewResult;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      listRun.current?.abort();
      detailRun.current?.abort();
      for (const controller of mutations.current.values()) controller.abort();
    },
    []
  );
  function close() {
    listRun.current?.abort();
    detailRun.current?.abort();
    selectedId.current = null;
    setOpened(false);
    setRows(null);
    setSelected(null);
    setError("");
  }
  function loadList() {
    listRun.current?.abort();
    const controller = new AbortController();
    listRun.current = controller;
    setOpened(true);
    setError("");
    void apiGet<{ snapshots: SavedRow[] }>("/v2/ai/overview/snapshots", {
      auth: true,
      signal: controller.signal
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setRows(data.snapshots.filter((row) => !deleted.current.has(row.id)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Uložené přehledy nejsou dostupné.");
      });
  }
  function openDetail(id: string) {
    detailRun.current?.abort();
    const controller = new AbortController();
    detailRun.current = controller;
    selectedId.current = id;
    setSelected(null);
    setError("");
    void apiGet<{ recipe: OverviewRequest; result: OverviewResult }>(
      `/v2/ai/overview/snapshots/${id}`,
      { auth: true, signal: controller.signal }
    )
      .then((data) => {
        if (controller.signal.aborted || selectedId.current !== id || deleted.current.has(id))
          return;
        if (!isOverviewResult(data.result)) throw new Error("Neplatný přehled");
        setSelected({ id, ...data });
      })
      .catch(() => {
        if (!controller.signal.aborted && selectedId.current === id)
          setError("Přehled nebo jeho původní zdroje již nejsou dostupné.");
      });
  }
  function remove(id: string) {
    if (mutations.current.has(id)) return;
    const controller = new AbortController();
    mutations.current.set(id, controller);
    setRemoving((current) => [...current, id]);
    void apiSendWithMetadata("DELETE", `/v2/ai/overview/snapshots/${id}`, undefined, {
      auth: true,
      signal: controller.signal
    })
      .then(() => {
        if (controller.signal.aborted) return;
        deleted.current.add(id);
        setRows((current) => current?.filter((row) => row.id !== id) ?? null);
        if (selectedId.current === id) {
          detailRun.current?.abort();
          selectedId.current = null;
          setSelected(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Přehled se nepodařilo odstranit.");
      })
      .finally(() => {
        mutations.current.delete(id);
        if (!controller.signal.aborted)
          setRemoving((current) => current.filter((value) => value !== id));
      });
  }
  return (
    <section>
      <Button variant="text" icon="auto_awesome" onClick={() => (opened ? close() : loadList())}>
        Uložené přehledy
      </Button>
      {opened && (
        <>
          {error && (
            <InlineNotice tone="warning">
              {error}
              <Button variant="text" onClick={loadList}>
                Opakovat
              </Button>
            </InlineNotice>
          )}
          {!rows && !error && <p role="status">Načítám uložené přehledy…</p>}
          {rows?.length === 0 && <p>Zatím nemáte uložený přehled.</p>}
          {rows?.map((row) => (
            <div key={row.id}>
              <Button
                variant="text"
                disabled={removing.includes(row.id)}
                onClick={() => openDetail(row.id)}
              >
                {row.title} · {new Date(row.createdAt).toLocaleDateString()}
              </Button>
              <Button
                variant="text"
                icon="delete"
                disabled={removing.includes(row.id)}
                onClick={() => remove(row.id)}
              >
                Odstranit
              </Button>
            </div>
          ))}
          {selected && (
            <OverviewView
              key={selected.id}
              request={selected.recipe}
              savedSnapshot={selected.result}
            />
          )}
        </>
      )}
    </section>
  );
}
