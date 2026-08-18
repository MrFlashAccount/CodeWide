import type { TurnControlsValue } from "./turn-controls-types";

export type TurnControlsSection = keyof TurnControlsValue;
export type TurnControlsLoaders = {
  [Section in TurnControlsSection]: () => Promise<TurnControlsValue[Section]>;
};

export type TurnControlsLoadResult = {
  value: TurnControlsValue;
  errors: Error[];
  loadedSections: number;
};

/**
 * Fetches independent catalogs concurrently and publishes every successful
 * section immediately. A slow skill scan can never hold model/permission UI.
 */
export async function loadTurnControlsIncrementally(
  initial: TurnControlsValue,
  loaders: TurnControlsLoaders,
  onPartial: (value: TurnControlsValue, section: TurnControlsSection) => void,
  timeoutMs = 12_000,
): Promise<TurnControlsLoadResult> {
  const current = cloneTurnControls(initial);
  const loadSection = async <Section extends TurnControlsSection>(section: Section): Promise<Error | null> => {
    try {
      const value = await withTimeout(loaders[section](), timeoutMs, section);
      assignSection(current, section, value);
      onPartial(cloneTurnControls(current), section);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause : new Error(`Could not load ${section}`);
    }
  };
  const results = await Promise.all([
    loadSection("models"),
    loadSection("skills"),
    loadSection("permissions"),
  ]);
  const errors = results.filter((error): error is Error => error !== null);
  return { value: current, errors, loadedSections: 3 - errors.length };
}

export function cloneTurnControls(value: TurnControlsValue): TurnControlsValue {
  return {
    models: value.models.map((model) => ({ ...model, efforts: [...model.efforts] })),
    skills: value.skills.map((skill) => ({ ...skill })),
    permissions: value.permissions.map((permission) => ({ ...permission })),
  };
}

function assignSection<Section extends TurnControlsSection>(
  target: TurnControlsValue,
  section: Section,
  value: TurnControlsValue[Section],
): void {
  // Indexed assignment cannot retain the key/value correlation from the
  // mapped loader type. Keep that TypeScript limitation inside this module.
  Object.assign(target, { [section]: value });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} catalog timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
