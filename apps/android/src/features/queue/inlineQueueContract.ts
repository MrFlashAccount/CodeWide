import type { ReactNode } from "react";

/** Stable display projection of one queued prompt. */
export interface InlineQueueOverlayItem {
  readonly attachmentCount: number;
  readonly createdAt: number;
  readonly id: string;
  readonly lastError: string | null;
  readonly state: "queued" | "uncertain" | "failed";
  readonly text: string;
}

/** Queue data, layout limits, and explicit item actions accepted by the overlay. */
export interface InlineQueueOverlayProps {
  readonly activeTurnId: string | null;
  readonly expanded: boolean;
  readonly items: readonly InlineQueueOverlayItem[];
  readonly maxHeight: number;
  onCancel?: (itemId: string) => Promise<void>;
  onClose: () => void;
  onEdit?: (itemId: string) => void;
  onMove?: (itemId: string, direction: -1 | 1) => Promise<void>;
  onOpen: () => void;
  onRefresh?: () => Promise<unknown>;
  onRetry?: (itemId: string) => Promise<void>;
  onSteer?: (itemId: string, activeTurnId: string) => Promise<void>;
}

/** Measured position and animation targets for one queue item. */
export interface QueueLayout {
  readonly height: number;
  readonly item: InlineQueueOverlayItem;
  readonly targetOpacity: number;
  readonly targetScale: number;
  readonly targetY: number;
}

/** Visual state and actions accepted by an animated queue bubble. */
export interface AnimatedQueueBubbleProps {
  readonly children: ReactNode;
  readonly deleteEnabled: boolean;
  readonly expanded: boolean;
  readonly failed: boolean;
  readonly index: number;
  readonly itemCount: number;
  readonly measuredHeight: number;
  onDelete: () => Promise<boolean>;
  onMeasure: (height: number) => void;
  onReorder: (offset: number) => Promise<boolean>;
  onSteer: () => Promise<boolean>;
  readonly raised: boolean;
  readonly reorderEnabled: boolean;
  readonly steerEnabled: boolean;
  readonly swipeDismissDistance: number;
  readonly targetOpacity: number;
  readonly targetScale: number;
  readonly targetY: number;
}
