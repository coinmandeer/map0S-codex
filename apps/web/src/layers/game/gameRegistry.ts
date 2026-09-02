import type { GameManifest } from "@mapos/layer-sdk";
import type { ThreeScene } from "./threeScene";

export interface GameRuntimeContext {
  scene: ThreeScene;
  apiBase: string;
}

export interface GameRuntimeModule {
  manifest: GameManifest;
  onPlayerPosition?(position: { lng: number; lat: number }): void;
  onTimeCursor?(cursor: string): void;
  textState(): Record<string, unknown>;
  destroy(): void;
}

export type GameRuntimeFactory = (context: GameRuntimeContext) => GameRuntimeModule;

const factories = new Map<string, GameRuntimeFactory>();

export function registerGame(factory: GameRuntimeFactory, id: string) {
  if (factories.has(id)) throw new Error(`Game runtime "${id}" is already registered`);
  factories.set(id, factory);
}

export function createGameRuntime(id: string, context: GameRuntimeContext) {
  return factories.get(id)?.(context) ?? null;
}

export function registeredGameIds() {
  return [...factories.keys()];
}
