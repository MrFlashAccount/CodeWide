import type { ConnectionInput } from "../../data/connection-validation";

/** One mounted pairing session; a close preserves its rendered content until the next open. */
export type ConnectionSheetProps = {
  visible: boolean;
  localReady: boolean;
  localError: string | null;
  onRetryStartup(): Promise<void>;
  onClose(): void;
  onSave(input: ConnectionInput): Promise<void>;
  initialCode: string | null;
};
export type ConnectionSheetSessionProps = ConnectionSheetProps & {
  saving: boolean;
  setSaving(value: boolean): void;
};
