import { providerBudgets } from "./repository.js";
/** All Mapy keys in this project share one verified allocation and one credit counter. */
export function mapyBudget(operation: "tile" | "geocode" | "route" | "matrix" | "elevation") {
  const account = process.env.MAPY_BUDGET_ACCOUNT ?? "";
  const units = operation === "tile" ? 1 : operation === "matrix" ? 40 : 4;
  return {
    scope: `mapy-credits:${account}:${operation}`,
    reserve: (signal: AbortSignal) =>
      providerBudgets.reserve({ product: "mapy-credits", account, operation, units }, signal)
  };
}
