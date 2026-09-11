import { Box, Icon } from "@expo/ui/jetpack-compose";
import type { ReactElement } from "react";
import { size } from "@expo/ui/jetpack-compose/modifiers";

import type { ComposeIconName } from "./composeIconNames";
import { composeIconSources } from "./composeIconSources";

interface ComposeNamedIconProps {
  name: ComposeIconName;
  size: number;
  color: string;
}

/** A decorative native icon inside an existing Compose Host; never embeds RN content. */
export function ComposeNamedIcon(props: ComposeNamedIconProps): ReactElement {
  // Expo paints nothing until its asynchronous native asset loader resolves.
  // Reserve the slot independently so loading/recycling never moves adjacent text.
  return (
    <Box modifiers={[size(props.size, props.size)]}>
      <Icon source={composeIconSources[props.name]} size={props.size} tint={props.color} />
    </Box>
  );
}
