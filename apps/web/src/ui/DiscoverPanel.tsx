import { useState } from "react";
import { getCountryNameCs } from "../lib/countries";
import { getExploreHeroCopy } from "../lib/explore-hero-i18n";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PanelShell } from "./PanelShell";
import { TabBar, type TabItem } from "./primitives";
import { GuideTab } from "./discover/GuideTab";
import { PeopleTab } from "./discover/PeopleTab";
import { RegionsTab } from "./discover/RegionsTab";

/**
 * Discover, as four things rather than one scroll.
 *
 * Regions, an editorial guide, what is on, and what other people pinned answer different
 * questions and come from different sources. They used to share one tree gated by `isCz &&`
 * and `crumbs.length < 3 &&` conditions; tabs let each own its own fetching and empty state.
 */
const TABS: TabItem[] = [
  { id: "regions", label: "Regiony", icon: "🗺️" },
  { id: "guide", label: "Průvodce", icon: "📖" },
  { id: "people", label: "Lidé", icon: "👥" }
];

export function DiscoverPanel() {
  const open = useMapStoreSnapshot((s) => s.sidebarOpen);
  const mode = useMapStoreSnapshot((s) => s.mode);
  const countryCode = useMapStoreSnapshot((s) => s.countryCode);
  const activeTag = useMapStoreSnapshot((s) => s.activeTag);
  const [tab, setTab] = useState("regions");

  const hero = getExploreHeroCopy(countryCode);

  if (!open || mode !== "discover") return null;

  return (
    <PanelShell title="Objevuj" testId="discover-panel" className="discover-panel">
      <>
        <div className="discover-hero">
          <h3>{hero.title}</h3>
          <p className="meta">{hero.subtitle}</p>
          <p className="meta">{getCountryNameCs(countryCode)}</p>
        </div>

        <TabBar tabs={TABS} active={tab} onChange={setTab} testId="discover-tab" />

        {tab === "regions" && <RegionsTab countryCode={countryCode} activeTag={activeTag} />}
        {tab === "guide" && <GuideTab />}
        {tab === "people" && <PeopleTab countryCode={countryCode} activeTag={activeTag} />}
      </>
    </PanelShell>
  );
}
