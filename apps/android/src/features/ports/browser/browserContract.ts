export type InternalBrowserHeader = {
  title: string;
  closeLabel: string;
  onClose(): void;
  status?: string;
};
