import { useSelector } from "@legendapp/state/react";
import { useContext } from "react";
import { Pressable } from "react-native";
import { useEvent } from "../../react/useEvent";
import { browserTabCatalog } from "../../services/browser/browserTabCatalog";
import {
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../../services/threads/threadRouteParams";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { ComposerContextCount } from "../../ui/ResourceContextChip";
import { BrowserTabsNavigationContext } from "./BrowserTabsNavigationContext";
import { styles } from "./ComposerBrowserContextChip.styles";

// InlineIcon uses a typographic role, distinct from ARIA roles.
const CHIP_ICON_ROLE = "label";

/** Opens the current chat's browser; the chip never admits page data to the composer. */
export function ComposerBrowserContextChip(props: {
  readonly connectionId: string | null;
  readonly threadId: string | null;
}): React.JSX.Element | null {
  const parsed = v1ThreadRouteParams({
    ...(props.connectionId === null ? {} : { connectionId: props.connectionId }),
    ...(props.threadId === null ? {} : { threadId: props.threadId }),
  });
  return parsed.status === "valid" ? <BrowserChip thread={parsed.value} /> : null;
}

function BrowserChip({
  thread,
}: {
  readonly thread: V1ThreadRouteParams;
}): React.JSX.Element | null {
  const openBrowser = useContext(BrowserTabsNavigationContext);
  const model = browserTabCatalog.forThread(thread);
  const count = useSelector(() => {
    const state = model.state$.get();
    return state.kind === "empty" ? 0 : state.before.length + 1 + state.after.length;
  });
  const open = useEvent(() => openBrowser?.(thread));
  if (openBrowser === null) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={`Browser: ${String(count)} tabs`}
      accessibilityRole="button"
      onPress={open}
      style={styles.chip}
      testID="composer-browser-chip"
    >
      {/* WHY: InlineIcon's role selects typography; it is not an HTML ARIA role. */}
      {/* oxlint-disable-next-line react-doctor/aria-role */}
      <InlineIcon color={colors.textMuted} name="globe-outline" role={CHIP_ICON_ROLE} />
      <ComposerContextCount label="Browser" testID="composer-browser-label" value={count} />
    </Pressable>
  );
}
