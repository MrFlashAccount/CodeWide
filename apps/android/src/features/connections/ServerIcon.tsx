import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import type { InlineIconRole } from "../../ui/inline-icon-metrics";
import { serverIconOption, type ServerIconId } from "../../data/serverIcons";

/** Renders a validated server icon through the application's shared icon component. */
export function ServerIcon({
  color = colors.textMuted,
  iconId,
  metric = "body",
}: {
  readonly color?: string;
  readonly iconId: ServerIconId;
  readonly metric?: InlineIconRole;
}): React.JSX.Element {
  return <InlineIcon color={color} name={serverIconOption(iconId).name} role={metric} />;
}
