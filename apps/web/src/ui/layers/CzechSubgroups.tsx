import { useEffect, useState, type ReactNode } from "react";
import { CZECH_SUBGROUPS } from "../../layers/plugins/czechSources";
import { st } from "../../statistics/labels";
import { Icon } from "../kit";
import { catalogGroupState, type CatalogItem, type CatalogLayers } from "./catalogModel";

export function CzechSubgroups({
  items,
  layers,
  reasonFor,
  change,
  renderRow,
  revealItem
}: {
  items: CatalogItem[];
  layers: CatalogLayers;
  reasonFor: (item: CatalogItem) => string | undefined;
  change: (item: CatalogItem, next: boolean) => void;
  renderRow: (item: CatalogItem) => ReactNode;
  revealItem: { id: string } | null;
}) {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem("mapos:cz-subgroups") ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const group = items.find((item) => item.id === revealItem?.id)?.subgroup?.id;
    if (group) setOpen((previous) => (previous.includes(group) ? previous : [...previous, group]));
  }, [revealItem, items]);
  useEffect(() => {
    try {
      sessionStorage.setItem("mapos:cz-subgroups", JSON.stringify(open));
    } catch {
      /* optional */
    }
  }, [open]);
  return (
    <div className="czech-subgroups">
      {CZECH_SUBGROUPS.map((group) => {
        const members = items.filter((item) => item.subgroup?.id === group.id);
        if (!members.length) return null;
        const { enabled, available, state } = catalogGroupState(members, layers, reasonFor);
        const expanded = open.includes(group.id);
        const label = st(group.cs, group.en);
        return (
          <section key={group.id} className="czech-subgroup">
            <div className="czech-subgroup-header">
              <button
                type="button"
                className="catalog-group-toggle"
                aria-expanded={expanded}
                aria-controls={`cz-group-${group.id}`}
                onClick={() =>
                  setOpen((previous) =>
                    previous.includes(group.id)
                      ? previous.filter((id) => id !== group.id)
                      : [...previous, group.id]
                  )
                }
              >
                <Icon name={expanded ? "expand_more" : "chevron_right"} size={20} />
                <span className="catalog-group-title">{label}</span>
                <span className="catalog-group-count">
                  {enabled}/{members.length}
                </span>
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={state}
                className="czech-group-check"
                aria-label={`${st(state === true ? "Vypnout" : "Zapnout", state === true ? "Disable" : "Enable")}: ${label} (${enabled}/${members.length})`}
                disabled={available === 0 && enabled === 0}
                data-testid={`cz-group-switch-${group.id}`}
                onClick={() =>
                  members.forEach((item) => {
                    if (state === true || !reasonFor(item)) change(item, state !== true);
                  })
                }
              >
                <span className="czech-check-mark">
                  {state && <Icon name={state === "mixed" ? "remove" : "check"} size={18} />}
                </span>
              </button>
            </div>
            {expanded && <div id={`cz-group-${group.id}`}>{members.map(renderRow)}</div>}
          </section>
        );
      })}
    </div>
  );
}
