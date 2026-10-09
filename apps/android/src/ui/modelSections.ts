import type { ModelAgentScope, ModelThinkingMenuProps } from "./TurnControlMenus.types";

type ModelControl = ModelThinkingMenuProps["models"][number];

/** Models of one provider, in catalog order; `provider` is `null` for unannotated rows. */
type ModelSection = {
  readonly models: readonly ModelControl[];
  readonly provider: string | null;
};

/** Whether the picker groups its models under provider headers: a new chat on a multi-provider server. */
export function groupsModelsByProvider(scope: ModelAgentScope | null | undefined): boolean {
  return scope?.kind === "newChat";
}

/** The catalog grouped by provider, providers in order of their first row. */
export function modelSections(models: readonly ModelControl[]): readonly ModelSection[] {
  const sections = new Map<string | null, ModelControl[]>();
  for (const model of models) {
    const provider = model.provider ?? null;
    const section = sections.get(provider);
    if (section === undefined) {
      sections.set(provider, [model]);
    } else {
      section.push(model);
    }
  }
  return Array.from(sections, ([provider, sectionModels]) => ({ models: sectionModels, provider }));
}
