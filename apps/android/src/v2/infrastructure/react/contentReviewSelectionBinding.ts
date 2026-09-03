export interface ContentReviewSelection {
  end: number;
  start: number;
  text: string;
}

export interface ContentReviewSelectionBindingInput {
  enabled: boolean;
  onSelection(selection: ContentReviewSelection): void;
  token: string;
}
