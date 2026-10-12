import type { ModelAgentScope } from "./TurnControlMenus.types";

/** A catalog row as far as grouping reads it. */
type ProviderRow = { readonly provider?: string | null };

/** Models of one provider, in catalog order; `provider` is `null` for unannotated rows. */
type ModelSection<Model extends ProviderRow> = {
  readonly models: readonly Model[];
  readonly provider: string | null;
};

/** Whether the picker groups its models under provider headers: a new chat on a multi-provider server. */
export function groupsModelsByProvider(scope: ModelAgentScope | null | undefined): boolean {
  return scope?.kind === "newChat";
}

/** The catalog grouped by provider, providers in order of their first row. */
export function modelSections<Model extends ProviderRow>(
  models: readonly Model[],
): readonly ModelSection<Model>[] {
  const sections = new Map<string | null, Model[]>();
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
