import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, iconSize } from "../theme";
import { providerBrand } from "./providerBrand";

/**
 * Monochrome mark of an agent provider, tinted with a theme color. Decorative:
 * the adjacent text names the provider. Unknown providers get a generic glyph.
 */
export function ProviderIcon({
  color = colors.textMuted,
  provider,
  size = iconSize.inline,
}: {
  readonly color?: string;
  readonly provider: string;
  readonly size?: number;
}): React.JSX.Element {
  const mark = providerBrand(provider).mark;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        flexShrink: 0,
        height: size,
        justifyContent: "center",
        width: size,
      }}
      testID={`provider-icon-${mark.kind === "generic" ? "generic" : provider}`}
    >
      {mark.kind === "generic" ? (
        <Ionicons color={color} name="sparkles-outline" size={size} />
      ) : (
        <Svg height={size} preserveAspectRatio="xMidYMid meet" viewBox={mark.viewBox} width={size}>
          <Path d={mark.path} fill={color} fillRule={mark.fillRule} />
        </Svg>
      )}
    </View>
  );
}
