export interface SettingsSectionDefinition {
  id: string;
  title: string;
  description?: string;
  icon: string;
  order: number;
}

export interface SettingsUiEntry<TContext, TOutput> {
  id: string;
  sectionId: string;
  order: number;
  render(context: TContext): TOutput;
}

export interface RegisteredSettingsSection<TContext, TOutput> extends SettingsSectionDefinition {
  entries: SettingsUiEntry<TContext, TOutput>[];
}

/** Small deterministic registry instead of a component-level preference switch statement. */
export class SettingsUiRegistry<TContext, TOutput> {
  readonly #sections = new Map<string, SettingsSectionDefinition>();
  readonly #entries = new Map<string, SettingsUiEntry<TContext, TOutput>>();

  registerSection(section: SettingsSectionDefinition): this {
    if (this.#sections.has(section.id))
      throw new Error(`Duplicate settings section: ${section.id}`);
    this.#sections.set(section.id, section);
    return this;
  }

  register(entry: SettingsUiEntry<TContext, TOutput>): this {
    if (!this.#sections.has(entry.sectionId)) {
      throw new Error(`Unknown settings section: ${entry.sectionId}`);
    }
    if (this.#entries.has(entry.id)) throw new Error(`Duplicate setting: ${entry.id}`);
    this.#entries.set(entry.id, entry);
    return this;
  }

  list(): RegisteredSettingsSection<TContext, TOutput>[] {
    return [...this.#sections.values()]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((section) => ({
        ...section,
        entries: [...this.#entries.values()]
          .filter((entry) => entry.sectionId === section.id)
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      }));
  }
}
