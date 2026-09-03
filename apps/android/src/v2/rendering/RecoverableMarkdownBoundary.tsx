import type { ReactNode } from "react";

import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";

interface RecoverableMarkdownBoundaryProps {
  children: ReactNode;
  recoveryKey: string;
}

/** Keeps Markdown failures local while participating in the app-wide repair flow. */
export function RecoverableMarkdownBoundary(
  props: RecoverableMarkdownBoundaryProps,
): React.JSX.Element {
  const { children, recoveryKey } = props;
  return (
    <RecoverableRenderBoundary label="Markdown response" resetKey={recoveryKey} scope="bubble">
      {children}
    </RecoverableRenderBoundary>
  );
}
