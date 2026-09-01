export interface AppDialogAction {
  onPress?(): void;
  style?: "default" | "cancel" | "destructive";
  text: string;
}

export interface AppDialogRequest {
  actions: readonly AppDialogAction[];
  message?: string;
  title: string;
}

export interface AppDialogSurfaceProps {
  isOpen: boolean;
  onAction(action: AppDialogAction): void;
  onDismiss(): void;
  request: AppDialogRequest | null;
}
