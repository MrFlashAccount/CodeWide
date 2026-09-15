import type { AccountPoolSnapshot } from "../../data/account-pool";

/** Account interaction capabilities; persistence and session state remain lower-owned. */
export type AccountPoolProps = {
  connectionId: string;
  accountPool: AccountPoolSnapshot | null;
  onRefresh(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartLogin(
    connectionId: string,
  ): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelLogin(connectionId: string, loginId: string): Promise<void>;
  onActivate(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdate(
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot>;
  onRemove(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
};
