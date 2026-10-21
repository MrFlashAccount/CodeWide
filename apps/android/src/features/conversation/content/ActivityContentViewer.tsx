import { useState } from "react";
import type { ContentPresentation } from "../../../services/content/contentRouteSession";
import { formatContentBytes } from "./FullContentViewer";
import { renderFullContentViewerBody } from "./FullContentViewerBody";

/** Adapts retained or live inline activity text to the shared full-screen output body. */
export function ActivityContentViewer({
  error = null,
  loading = false,
  onClose,
  presentation,
  text,
  title,
}: {
  readonly error?: string | null;
  readonly loading?: boolean;
  readonly onClose: () => void;
  readonly presentation: ContentPresentation;
  readonly text: string;
  readonly title: string;
}): React.JSX.Element {
  const [viewportHeight, setViewportHeight] = useState(0);
  const byteLength = new TextEncoder().encode(text).byteLength;
  return renderFullContentViewerBody({
    formatContentBytes,
    hasNext: false,
    hasPrevious: false,
    onClose,
    onNext: noAction,
    onPrevious: noAction,
    rangeEnd: byteLength,
    selection: {
      error,
      loading,
      nextOffset: byteLength,
      offset: 0,
      pointer: "/",
      presentation,
      reference: { byteLength },
      text,
    },
    setViewportHeight,
    title,
    viewportHeight,
  });
}

function noAction(): void {}
