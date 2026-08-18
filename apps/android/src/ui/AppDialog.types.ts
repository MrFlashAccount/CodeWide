export type AppDialogAction = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?(): void;
};

export type AppDialogRequest = {
  title: string;
  message?: string;
  actions: readonly AppDialogAction[];
};

export type AppDialogSurfaceProps = {
  isOpen: boolean;
  request: AppDialogRequest | null;
  onDismiss(): void;
  onAction(action: AppDialogAction): void;
};
