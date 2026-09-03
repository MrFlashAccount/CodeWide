import type { V2Attachment } from "@codewide/sync-client/v2";

export interface AttachmentGallery {
  canGoNext: boolean;
  canGoPrevious: boolean;
  count: number;
  index: number;
  onNext(): void;
  onPrevious(): void;
}

export function attachmentGallery(
  images: V2Attachment[],
  index: number,
  select: (id: string) => void,
): AttachmentGallery {
  const selectIndex = (nextIndex: number): void => {
    const next = images[nextIndex];
    if (next !== undefined) select(next.id);
  };
  return {
    canGoNext: index >= 0 && index < images.length - 1,
    canGoPrevious: index > 0,
    count: Math.max(1, images.length),
    index: Math.max(0, index),
    onNext: () => selectIndex(index + 1),
    onPrevious: () => selectIndex(index - 1),
  };
}
