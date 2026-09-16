import type { AccountPoolSnapshot } from "../../data/account-pool";

/** Account interaction capabilities; persistence and session state remain lower-owned. */
export type AccountPoolProps = {
  accountPool: AccountPoolSnapshot | null;
  connectionId: string;
  onActivate: (connectionId: string, profileId: string) => Promise<AccountPoolSnapshot>;
  onCancelLogin: (connectionId: string, loginId: string) => Promise<void>;
  onRefresh: (connectionId: string) => Promise<AccountPoolSnapshot>;
  onRemove: (connectionId: string, profileId: string) => Promise<AccountPoolSnapshot>;
  onStartLogin: (
    connectionId: string,
  ) => Promise<{ loginId: string; userCode: string; verificationUrl: string }>;
  onUpdate: (
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ) => Promise<AccountPoolSnapshot>;
};
