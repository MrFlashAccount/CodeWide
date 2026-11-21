/** Which project-management sheet a local presenter shows; Add project returns to Manage Projects. */
export type LocalProjectManagementPage =
  | { readonly kind: "closed" }
  | { readonly kind: "projects" }
  | { readonly connectionId: string | null; readonly kind: "add" };

export const CLOSED_PROJECT_MANAGEMENT: LocalProjectManagementPage = { kind: "closed" };
export const OPEN_PROJECT_MANAGEMENT: LocalProjectManagementPage = { kind: "projects" };
