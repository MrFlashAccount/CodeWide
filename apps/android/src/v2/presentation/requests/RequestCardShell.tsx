import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { requestStyles } from "./requestStyles";

interface RequestCardShellProps extends PropsWithChildren {
  embedded: boolean;
  error: string | null;
  pending: boolean;
  position: string | null;
  title: string;
}

export function RequestCardShell(props: RequestCardShellProps): React.JSX.Element {
  const { children, embedded, error, pending, position, title } = props;
  return (
    <View
      accessibilityLabel={title}
      style={[requestStyles.card, embedded && requestStyles.embeddedCard]}
    >
      <View style={requestStyles.titleRow}>
        <PresentationIcon color={colors.amber} name="shield" size={21} />
        <ProductText numberOfLines={1} style={requestStyles.title} weight="semibold">
          {title}
        </ProductText>
        {position === null ? null : <ProductText tone="muted">{position}</ProductText>}
        {pending ? (
          <ShimmerText
            style={requestStyles.pendingText}
            text="RESOLVING…"
            widthPolicy="intrinsic"
          />
        ) : null}
      </View>
      {children}
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={requestStyles.error} tone="danger">
          {error}
        </ProductText>
      )}
    </View>
  );
}
