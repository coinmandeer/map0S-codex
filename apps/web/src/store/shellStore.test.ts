import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppMode, type AppMode, type AppModeInput } from "../product/registry";
import type { SheetType } from "./mapStore";
import { ShellStore, type ShellSource } from "./shellStore";

class FakeShellSource implements ShellSource {
  mode: AppMode = "planning";
  sidebarOpen = true;
  sheet: SheetType = null;
  readonly modeInputs: AppModeInput[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMode(input: AppModeInput): void {
    this.modeInputs.push(input);
    this.mode = resolveAppMode(input).mode;
    this.sidebarOpen = true;
    this.notify();
  }

  setSidebarOpen(open: boolean): void {
    this.sidebarOpen = open;
    this.notify();
  }

  togglePanel(): void {
    this.setSidebarOpen(!this.sidebarOpen);
  }

  openSheet(sheet: SheetType): void {
    this.sheet = sheet;
    this.notify();
  }

  closeSheet(): void {
    this.openSheet(null);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

test("shell facade exposes canonical state and mode transitions", () => {
  const source = new FakeShellSource();
  const shell = new ShellStore(source);
  let notifications = 0;
  const unsubscribe = shell.subscribe(() => {
    notifications += 1;
  });

  assert.deepEqual(shell.snapshot.leftContext, { type: "mode", mode: "planning" });
  shell.setMode("game");
  assert.equal(shell.snapshot.mode, "game");
  assert.deepEqual(shell.snapshot.leftContext, { type: "mode", mode: "game" });
  shell.setMode("discover");
  assert.deepEqual(shell.snapshot.leftContext, { type: "mode", mode: "discover" });
  assert.equal(notifications, 2);

  unsubscribe();
  shell.dispose();
});

test("shell facade keeps legacy callers on canonical state", () => {
  const source = new FakeShellSource();
  const shell = new ShellStore(source);

  shell.setMode("mine");
  assert.equal(shell.snapshot.mode, "personal");
  shell.setMode("weather");
  assert.equal(shell.snapshot.mode, "discover");
  assert.deepEqual(
    source.modeInputs,
    ["mine", "weather"],
    "the source sees aliases once so weather can preserve its additive layer migration"
  );

  shell.dispose();
});

test("legacy sheet methods map through the facade while surfaces migrate", () => {
  const source = new FakeShellSource();
  const shell = new ShellStore(source);

  shell.openLegacySheet("settings");
  assert.equal(shell.snapshot.legacySheet, "settings");
  shell.closeLegacySheet();
  assert.equal(shell.snapshot.legacySheet, null);
  shell.closeLeftContext();
  assert.deepEqual(shell.snapshot.leftContext, { type: "closed" });
  shell.openLeftContext();
  assert.deepEqual(shell.snapshot.leftContext, { type: "mode", mode: "planning" });

  shell.dispose();
});

test("right utilities stay exclusive and external legacy callers are normalized", () => {
  const source = new FakeShellSource();
  const shell = new ShellStore(source);

  shell.openRightUtility("layers");
  assert.deepEqual(shell.snapshot.rightUtility, { type: "layers" });
  assert.equal(source.sheet, null, "Layers has no legacy sheet twin");

  shell.openRightUtility("basemaps");
  assert.deepEqual(shell.snapshot.rightUtility, { type: "basemaps" });
  assert.equal(source.sheet, "tiles");

  source.openSheet("auth");
  assert.deepEqual(shell.snapshot.rightUtility, { type: "closed" });
  assert.deepEqual(shell.snapshot.modal, { type: "legacy", sheet: "auth" });

  shell.dispose();
});

test("footer registration is reference counted while state stays data-only", () => {
  const source = new FakeShellSource();
  const shell = new ShellStore(source);
  const descriptor = { id: "timeline", kind: "timeline" as const, priority: 100 };

  const unregisterA = shell.registerFooterContribution(descriptor);
  const unregisterB = shell.registerFooterContribution(descriptor);
  assert.deepEqual(shell.snapshot.footerContributions, [descriptor]);
  assert.doesNotThrow(() => structuredClone(shell.snapshot));

  unregisterA();
  assert.deepEqual(shell.snapshot.footerContributions, [descriptor]);
  unregisterB();
  assert.deepEqual(shell.snapshot.footerContributions, []);

  shell.dispose();
});
