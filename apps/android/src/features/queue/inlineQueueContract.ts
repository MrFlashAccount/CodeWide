import type { ReactNode } from "react";

/** Stable display projection of one queued prompt. */
export interface InlineQueueOverlayItem {
  readonly id: string;
  readonly text: string;
  readonly attachmentCount: number;
  readonly createdAt: number;
  readonly state: "queued" | "uncertain" | "failed";
  readonly lastError: string | null;
}

/** Queue data, layout limits, and explicit item actions accepted by the overlay. */
export interface InlineQueueOverlayProps {
  readonly maxHeight: number;
  readonly expanded: boolean;
  readonly items: readonly InlineQueueOverlayItem[];
  readonly activeTurnId: string | null;
  onOpen(): void;
  onClose(): void;
  onEdit?(itemId: string): void;
  onCancel?(itemId: string): Promise<void>;
  onMove?(itemId: string, direction: -1 | 1): Promise<void>;
  onRetry?(itemId: string): Promise<void>;
  onSteer?(itemId: string, activeTurnId: string): Promise<void>;
  onRefresh?(): Promise<unknown>;
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
  readonly raised: boolean;
  readonly reorderEnabled: boolean;
  readonly steerEnabled: boolean;
  readonly swipeDismissDistance: number;
  readonly targetOpacity: number;
  readonly targetScale: number;
  readonly targetY: number;
  onDelete(): Promise<boolean>;
  onMeasure(height: number): void;
  onReorder(offset: number): Promise<boolean>;
  onSteer(): Promise<boolean>;
}
