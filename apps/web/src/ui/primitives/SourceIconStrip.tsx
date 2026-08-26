export type SourceState = "idle" | "loading" | "ready" | "error";

export interface SourceStatusItem {
  id: string;
  label: string;
  glyph: string;
  state: SourceState;
  count?: number;
  message?: string;
}

/** Minimal per-source loader: instead of stacking skeleton blocks, each data source gets a
 *  single glyph with a progress ring drawn straight through it. Loading spins the ring,
 *  ready fills it, error leaves a small dot. Enough signal to know what is still arriving,
 *  small enough to sit in a panel header. */
export function SourceIconStrip({
  sources,
  testId = "source-strip"
}: {
  sources: SourceStatusItem[];
  testId?: string;
}) {
  const shown = sources.filter((s) => s.state !== "idle");
  if (!shown.length) return null;

  return (
    <div className="source-strip" data-testid={testId}>
      {shown.map((source) => (
        <span
          key={source.id}
          className={`source-dot source-dot-${source.state}`}
          data-testid={`source-${source.id}`}
          data-state={source.state}
          title={
            source.message ??
            `${source.label}: ${
              source.state === "loading"
                ? "načítá se…"
                : source.state === "error"
                  ? "nedostupné"
                  : `${source.count ?? 0} míst`
            }`
          }
        >
          <span className="source-glyph" aria-hidden>
            {source.glyph}
          </span>
          <span className="visually-hidden">
            {source.label} — {source.state}
          </span>
        </span>
      ))}
    </div>
  );
}
