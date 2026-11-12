import { Ionicons } from "@expo/vector-icons";
import { toByteArray } from "base64-js";
import { Image, View } from "react-native";
import Svg, { Path, SvgXml } from "react-native-svg";

import { colors, iconSize } from "../theme";

/**
 * A plugin-supplied forge mark that already passed the data-layer decoder:
 * `glyph` is bounded SVG path data in a validated `0 0 W H` box, `image` is
 * bounded standard base64 of one allowed format. Never raw, unvalidated input.
 */
export type ForgeIconSource =
  | { readonly kind: "glyph"; readonly path: string; readonly viewBox: string }
  | {
      readonly dataBase64: string;
      readonly kind: "image";
      readonly mimeType: "image/png" | "image/svg+xml" | "image/webp";
    };

/**
 * Forge provider mark exactly as the Companion resolved it from the provider's
 * plugin. A glyph is one `Path` tinted with `color`; an image keeps its own
 * colours; `null` (or an SVG that fails to parse) is the neutral icon. Android
 * never chooses a mark by provider name. Decorative: adjacent text names the
 * forge. Holds no data and imports no data or feature module.
 */
export function ForgeIcon({
  color = colors.textMuted,
  icon,
  size = iconSize.inline,
}: {
  readonly color?: string;
  readonly icon: ForgeIconSource | null;
  readonly size?: number;
}): React.JSX.Element {
  const neutral = <Ionicons color={color} name="git-pull-request-outline" size={size} />;
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
      testID={`forge-icon-${icon === null ? "generic" : icon.kind}`}
    >
      {icon === null ? (
        neutral
      ) : (
        <ForgeMark color={color} fallback={neutral} icon={icon} size={size} />
      )}
    </View>
  );
}

function ForgeMark({
  color,
  fallback,
  icon,
  size,
}: {
  readonly color: string;
  readonly fallback: React.JSX.Element;
  readonly icon: ForgeIconSource;
  readonly size: number;
}): React.JSX.Element {
  if (icon.kind === "glyph") {
    return (
      <Svg height={size} preserveAspectRatio="xMidYMid meet" viewBox={icon.viewBox} width={size}>
        <Path d={icon.path} fill={color} />
      </Svg>
    );
  }
  if (icon.mimeType === "image/svg+xml") {
    return (
      <SvgXml
        fallback={fallback}
        height={size}
        onError={ignoreUnparsableSvg}
        width={size}
        xml={new TextDecoder().decode(toByteArray(icon.dataBase64))}
      />
    );
  }
  return (
    <Image
      resizeMode="contain"
      source={{ uri: `data:${icon.mimeType};base64,${icon.dataBase64}` }}
      style={{ height: size, width: size }}
    />
  );
}

/** An unparsable plugin SVG is not an app failure: `fallback` already shows the neutral icon. */
function ignoreUnparsableSvg(): void {}
