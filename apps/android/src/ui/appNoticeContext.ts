import { createContext, type ReactNode } from "react";

export interface AppNoticeRequest {
  readonly actionLabel?: string;
  readonly description?: string;
  readonly duration?: number;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly onActionPress?: () => void;
}

export interface AppNoticeController {
  readonly show: (request: AppNoticeRequest) => void;
}

/** Application-wide transient notice capability. */
export const AppNoticeContext = createContext<AppNoticeController | null>(null);
