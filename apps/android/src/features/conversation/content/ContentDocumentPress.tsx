import { useContext, type ReactNode } from "react";
import { Pressable } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { DocumentContentRouteRequest } from "../../../services/content/contentRouteSession";
import { LargeContentViewerContext } from "./contentViewerContext";

/**
 * Makes content that shows only a preview open its whole document on press.
 * Without a document or a viewer the content renders as it is.
 */
export function ContentDocumentPress({
  accessibilityLabel,
  children,
  document,
}: {
  readonly accessibilityLabel: string;
  readonly children: ReactNode;
  readonly document: DocumentContentRouteRequest | null;
}): ReactNode {
  const openContent = useContext(LargeContentViewerContext);
  const open = useEvent(() => {
    if (openContent !== null && document !== null) {
      openContent(document);
    }
  });
  if (openContent === null || document === null) {
    return children;
  }
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={open}>
      {children}
    </Pressable>
  );
}
