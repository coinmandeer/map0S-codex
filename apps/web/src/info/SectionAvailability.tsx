import { createContext, useContext, useEffect } from "react";

export const SectionAvailability = createContext<
  ((state: { empty?: boolean; error?: boolean }) => void) | null
>(null);

/** Report emptiness without unmounting the lookup and starting it again in a loop. */
export function useSectionEmpty(empty: boolean) {
  const report = useContext(SectionAvailability);
  useEffect(() => {
    report?.({ empty });
  }, [report, empty]);
}
