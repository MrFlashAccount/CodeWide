export type AppDialogAction = {
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
  text: string;
};

export type AppDialogRequest = {
  actions: readonly AppDialogAction[];
  diagnostic?: string;
  message?: string;
  title: string;
};

export type AppDialogSurfaceProps = {
  isOpen: boolean;
  onAction: (action: AppDialogAction) => void;
  onDismiss: () => void;
  request: AppDialogRequest | null;
};
