import type { ComponentProps } from "react";

import { NebulaOrb as WebNebulaOrb } from "./NebulaOrb.web";

/** Unsupported-platform fallback; Metro selects a platform owner before this module. */
export function NebulaOrb(props: ComponentProps<typeof WebNebulaOrb>): React.JSX.Element {
  return <WebNebulaOrb {...props} />;
}
