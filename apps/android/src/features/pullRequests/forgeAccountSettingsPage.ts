import type { ForgeAccountKey } from "../../data/forgeContract";

/** Identifies an account within its server. Its login labels the navigation header. */
export interface ForgeAccountSelection {
  readonly account: ForgeAccountKey;
  readonly connectionId: string;
  readonly login: string;
}

/** Pull request account content displayed by the settings sheet's page stack. */
export type ForgeAccountSettingsPage =
  | {
      readonly add: (connectionId: string) => void;
      readonly kind: "list";
      readonly open: (selection: ForgeAccountSelection) => void;
    }
  | { readonly back: () => void; readonly connectionId: string; readonly kind: "connect" }
  | {
      readonly back: () => void;
      readonly kind: "account";
      readonly selection: ForgeAccountSelection;
    };
