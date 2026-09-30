import { useContext, type ReactElement, type ReactNode } from "react";

import { RichMarkdownPremeasurementContext } from "./richMarkdownLayoutPolicy";
import { RichContentWidthProvider } from "./RichContentLayout";

/** Scopes Pretext-owned text layout to the experimental timeline only. */
export function RichMarkdownPremeasurementProvider({
  children,
  enabled,
  fontScale,
  width,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly fontScale: number;
  readonly width: number | null;
}): ReactElement {
  return (
    <RichMarkdownPremeasurementContext.Provider
      value={{ active: false, enabled, fontScale, width }}
    >
      {children}
    </RichMarkdownPremeasurementContext.Provider>
  );
}

/** Activates the configured policy only for agent Markdown rows owned by Pretext. */
export function RichMarkdownPremeasurementBoundary({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const policy = useContext(RichMarkdownPremeasurementContext);
  const active = policy.enabled && policy.width !== null;
  const content = (
    <RichMarkdownPremeasurementContext.Provider
      value={{ active, enabled: policy.enabled, fontScale: policy.fontScale, width: policy.width }}
    >
      {children}
    </RichMarkdownPremeasurementContext.Provider>
  );
  return (
    <RichContentWidthProvider width={active ? policy.width : null}>
      {content}
    </RichContentWidthProvider>
  );
}
