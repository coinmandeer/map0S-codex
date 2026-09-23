import { useEffect } from "react";
import { attachWorldRuntime } from "./runtime";
export function WorldBridge() {
  useEffect(attachWorldRuntime, []);
  return null;
}
