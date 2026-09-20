/** Header content and close action exposed to the internal browser shell. */
export type InternalBrowserHeader = {
  closeLabel: string;
  onClose: () => void;
  status?: string;
  title: string;
};
