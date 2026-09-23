import { lazy, Suspense } from "react";
import { Dialog, Skeleton } from "../ui/kit";
import { showStatistics, useStatistics } from "./explorerStore";
import { st } from "./labels";
const Explorer = lazy(() =>
  import("./StatisticsExplorer").then((m) => ({ default: m.StatisticsExplorer }))
);
export function StatisticsDialog() {
  const state = useStatistics();
  return (
    <Dialog
      open={state.open}
      onOpenChange={showStatistics}
      title={st("Statistiky a společnost", "Statistics & society")}
      size="lg"
      testId="statistics-dialog"
    >
      <Suspense fallback={<Skeleton count={3} />}>{state.open && <Explorer />}</Suspense>
    </Dialog>
  );
}
