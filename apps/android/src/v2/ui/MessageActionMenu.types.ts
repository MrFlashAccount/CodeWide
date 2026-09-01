import type { ReactNode } from "react";
export interface MessageActionMenuRequest {
  copyText: string;
  onFork?(): Promise<void>;
  onReview?(): Promise<void> | void;
}

export interface MessageActionMenuAnchor {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

export type OpenMessageActionMenu = (
  request: MessageActionMenuRequest,
  anchor: MessageActionMenuAnchor,
) => void;

export interface MessageActionMenuProviderProps {
  children: ReactNode;
}
