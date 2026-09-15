/** Header content and close action exposed to the internal browser shell. */
export type InternalBrowserHeader = {
  title: string;
  closeLabel: string;
  onClose(): void;
  status?: string;
};
