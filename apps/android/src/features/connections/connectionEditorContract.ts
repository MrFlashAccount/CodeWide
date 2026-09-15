import type { AccountPoolSnapshot } from "../../data/account-pool";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionUpdateInput } from "../../data/connection-validation";

/** Connection row inputs retain separate profile editing and account capabilities. */
export type ConnectionEditorProps = {
  connection: StoredConnection;
  onToggle(connectionId: string, enabled: boolean): Promise<void>;
  onReconnect(connectionId: string): Promise<void>;
  onDelete(connectionId: string): Promise<void>;
  onUpdate(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  onMove(connectionId: string, direction: -1 | 1): Promise<void>;
  accountPool: AccountPoolSnapshot | null;
  onRefreshAccountPool?(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartAccountLogin?(
    connectionId: string,
  ): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelAccountLogin?(connectionId: string, loginId: string): Promise<void>;
  onActivateAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdateAccountProfile?(
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
};
