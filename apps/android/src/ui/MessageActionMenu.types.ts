import type { ReactNode } from "react";

export type MessageActionMenuRequest = {
  copyText: string;
  onFork?: () => Promise<void>;
  onReview?: () => Promise<void> | void;
};

type MessageActionMenuAnchor = {
  height: number;
  pageX: number;
  pageY: number;
  width: number;
};

export type OpenMessageActionMenu = (
  request: MessageActionMenuRequest,
  anchor: MessageActionMenuAnchor,
) => void;

export type MessageActionMenuProviderProps = {
  children: ReactNode;
};
