import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAppMode, type AppMode, type AppModeInput } from "../product/registry.js";
import type { SheetType } from "./mapStore.js";
import { ShellBrowserHistoryBinding, type ShellHistoryPort } from "./shellBrowserHistory.js";
import { ShellStore, type ShellSource } from "./shellStore.js";

class FakeShellSource implements ShellSource {
  mode: AppMode = "planning";
  sidebarOpen = false;
  sheet: SheetType = null;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMode(input: AppModeInput): void {
    this.mode = resolveAppMode(input).mode;
    this.sidebarOpen = this.mode !== "game";
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

class FakeHistoryPort implements ShellHistoryPort {
  pushes = 0;
  backs = 0;
  private readonly listeners = new Set<() => void>();

  pushGuard(): void {
    this.pushes += 1;
  }

  back(): void {
    this.backs += 1;
  }

  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pop(): void {
    for (const listener of this.listeners) listener();
  }
}

describe("ShellBrowserHistoryBinding", () => {
  it("uses one guard and consumes nested surfaces one browser-back at a time", () => {
    const shell = new ShellStore(new FakeShellSource());
    const port = new FakeHistoryPort();
    const binding = new ShellBrowserHistoryBinding(shell, port);

    shell.openRightUtility("layers");
    shell.openRightUtility("settings");
    assert.equal(port.pushes, 1, "nested transitions reuse the active browser guard");

    port.pop();
    assert.deepEqual(shell.snapshot.rightUtility, { type: "layers" });
    assert.equal(port.pushes, 2, "a remaining surface installs the next one-shot guard");

    port.pop();
    assert.deepEqual(shell.snapshot.rightUtility, { type: "closed" });
    assert.equal(port.pushes, 2);

    binding.dispose();
    shell.dispose();
  });

  it("removes the guard after an explicit close without treating its pop as user Back", () => {
    const shell = new ShellStore(new FakeShellSource());
    const port = new FakeHistoryPort();
    const binding = new ShellBrowserHistoryBinding(shell, port);

    shell.openRightUtility("settings");
    shell.closeRightUtility();
    assert.equal(port.backs, 1);
    assert.deepEqual(shell.snapshot.rightUtility, { type: "closed" });

    port.pop();
    assert.deepEqual(shell.snapshot.rightUtility, { type: "closed" });

    binding.dispose();
    shell.dispose();
  });
});
