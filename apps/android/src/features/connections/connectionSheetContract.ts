import type { ConnectionInput } from "../../data/connection-validation";

/** One mounted pairing session; a close preserves its rendered content until the next open. */
export type ConnectionSheetProps = {
  initialCode: string | null;
  localError: string | null;
  localReady: boolean;
  onClose: () => void;
  onRetryStartup: () => Promise<void>;
  onSave: (input: ConnectionInput) => Promise<void>;
  visible: boolean;
};
/** Connection-sheet contract extended with session-owned save state. */
export type ConnectionSheetSessionProps = ConnectionSheetProps & {
  saving: boolean;
  setSaving: (value: boolean) => void;
};
