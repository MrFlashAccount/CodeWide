import type { ReactNode } from "react";
export interface MessageActionMenuRequest {
  copyText: string;
  onEdit?(): Promise<void> | void;
  onFork?(): Promise<void>;
  onInterrupt?(): Promise<void>;
  onReview?(): Promise<void> | void;
  onRollback?(): Promise<void>;
}

interface MessageActionMenuAnchor {
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
