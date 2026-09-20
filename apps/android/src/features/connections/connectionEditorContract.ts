import type { AccountPoolSnapshot, AccountResetCreditConsumption } from "../../data/account-pool";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionUpdateInput } from "../../data/connection-validation";

/** Connection row inputs retain separate profile editing and account capabilities. */
export type ConnectionEditorProps = {
  accountPool: AccountPoolSnapshot | null;
  connection: StoredConnection;
  onActivateAccountProfile?: (
    connectionId: string,
    profileId: string,
  ) => Promise<AccountPoolSnapshot>;
  onCancelAccountLogin?: (connectionId: string, loginId: string) => Promise<void>;
  onConsumeAccountResetCredit?: (
    connectionId: string,
    profileId: string,
    creditId: string | null,
  ) => Promise<AccountResetCreditConsumption>;
  onDelete: (connectionId: string) => Promise<void>;
  onReconnect: (connectionId: string) => Promise<void>;
  onRefreshAccountPool?: (connectionId: string) => Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?: (
    connectionId: string,
    profileId: string,
  ) => Promise<AccountPoolSnapshot>;
  onStartAccountLogin?: (
    connectionId: string,
  ) => Promise<{ loginId: string; userCode: string; verificationUrl: string }>;
  onToggle: (connectionId: string, enabled: boolean) => Promise<void>;
  onUpdate: (connectionId: string, input: ConnectionUpdateInput) => Promise<void>;
  onUpdateAccountProfile?: (
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ) => Promise<AccountPoolSnapshot>;
};
