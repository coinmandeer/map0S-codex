import { useEffect, useState } from "react";
import { on, type MapOsEvents } from "../lib/events";
import { getMapStore } from "../store/mapStore";
export function ClusterChoices() {
  const [choice, setChoice] = useState<MapOsEvents["cluster-list"] | null>(null);
  const [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(
    () =>
      on("cluster-list", (value) => {
        setChoice(value);
        setOffset(0);
        setLoading(false);
      }),
    []
  );
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChoice(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  if (!choice) return null;
  const move = async (next: number) => {
    if (!choice.page) return;
    setLoading(true);
    try {
      const features = await choice.page(next);
      setChoice((current) => {
        if (current !== choice) return current;
        setOffset(next);
        return { ...choice, features };
      });
    } catch {
      getMapStore().showToast("Seznam se změnil. Vyberte shluk znovu.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="area-controls cluster-choices" aria-label="Místa ve shluku">
      <strong>Místa v tomto bodě · {choice.total}</strong>
      <button onClick={() => setChoice(null)}>Zavřít</button>
      <div className="area-guide">
        {choice.features.map((feature, index) => (
          <button
            key={String(feature.properties.id ?? index)}
            style={{ display: "block", width: "100%", textAlign: "left" }}
            onClick={() => {
              getMapStore().selectPin({
                feature,
                layerId:
                  typeof feature.properties.layerId === "string"
                    ? feature.properties.layerId
                    : choice.layerId
              });
              setChoice(null);
            }}
          >
            {feature.properties.name || "Místo"}
          </button>
        ))}
      </div>
      {choice.page && (
        <>
          <button
            disabled={loading || offset === 0}
            onClick={() => void move(Math.max(0, offset - 100))}
          >
            Předchozí
          </button>
          <span>
            {offset + 1}–{offset + choice.features.length} / {choice.total}
          </span>
          <button
            disabled={loading || offset + choice.features.length >= choice.total}
            onClick={() => void move(offset + 100)}
          >
            Další
          </button>
        </>
      )}
    </section>
  );
}
