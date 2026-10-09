/** Header content and close action exposed to the internal browser shell. */
export type InternalBrowserHeader = {
  closeLabel: string;
  onClose: () => void;
  status?: string;
  title: string;
};

/** A tab count and its manager action come from the same browser catalog. */
export type BrowserTabsControl = {
  readonly count: number;
  readonly onNewTab?: () => void;
  readonly onOpen: () => void;
};
