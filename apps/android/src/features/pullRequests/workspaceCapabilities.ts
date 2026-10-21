import type {
  AccountState,
  AuthStartResult,
  DisconnectMode,
  ForgeAccountKey,
  ForgeProvider,
} from "../../data/forgeContract";

/** Connect-flow and account mutations of the Pull requests catalog for one connection. */
export type PullRequestsWorkspaceCapabilities = {
  /** Cancels a live host-login flow; the card returns to Connect after the accounts re-read. */
  readonly cancelAuth: (connectionId: string, flowId: string) => Promise<void>;
  /** Re-reads accounts and methods, for example after the user ran a host command. */
  readonly checkAgain: (connectionId: string) => Promise<void>;
  /**
   * Removes an account link. `logoutHost` requires the explicit destructive
   * confirmation the caller already obtained; `forgetToken` deletes a saved token.
   */
  readonly disconnect: (
    connectionId: string,
    request: {
      readonly account: ForgeAccountKey;
      readonly confirmation: "destructive" | "none";
      readonly mode: DisconnectMode;
    },
  ) => Promise<void>;
  readonly setProviderEnabled: (
    connectionId: string,
    pluginId: string,
    enabled: boolean,
  ) => Promise<ForgeProvider>;
  /** Starts linkExisting, hostLogin or an instructions re-check for one provider method. */
  readonly startAuth: (
    connectionId: string,
    request: {
      readonly host: string;
      readonly login: string | null;
      readonly methodId: string;
      readonly pluginId: string;
    },
  ) => Promise<AuthStartResult>;
  /**
   * Sends a pasted token once, directly to the companion. It never enters the
   * durable outbox, telemetry or any device store; the result never contains it.
   */
  readonly submitToken: (
    connectionId: string,
    request: { readonly host: string; readonly pluginId: string; readonly token: string },
  ) => Promise<AccountState>;
};
