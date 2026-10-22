import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, iconSize } from "../theme";

// GitHub mark (Octicons `mark-github`), shown only to identify the forge (GitHub logo guidelines).
const GITHUB_MARK = {
  path: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z",
  viewBox: "0 0 16 16",
} as const;

const GLYPH_VIEW_BOX = "0 0 24 24";

/**
 * Bundled forge marks by `iconKey`. GitLab and Arcanum use the generic icon:
 * GitLab is not a provider yet, and the Arcanum asset waits for confirmed usage terms.
 */
const BUNDLED_MARKS: Readonly<Record<string, { readonly path: string; readonly viewBox: string }>> =
  {
    github: GITHUB_MARK,
  };

/**
 * Monochrome forge provider mark, tinted with a theme color. It renders a
 * bundled brand mark for a known `iconKey`, else an already sanitized plugin
 * glyph as one `Path`, else the generic icon. Decorative: adjacent text names
 * the forge. Holds no data and imports no data or feature module.
 */
export function ForgeIcon({
  color = colors.textMuted,
  glyph,
  iconKey,
  size = iconSize.inline,
}: {
  readonly color?: string;
  /** A glyph that already passed the data-layer sanitizer; never raw markup. */
  readonly glyph: { readonly path: string } | null;
  readonly iconKey: string;
  readonly size?: number;
}): React.JSX.Element {
  const { kind, mark } = resolveMark(iconKey, glyph);
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
      testID={`forge-icon-${kind === "bundled" ? iconKey : kind}`}
    >
      {mark === null ? (
        <Ionicons color={color} name="git-pull-request-outline" size={size} />
      ) : (
        <Svg height={size} preserveAspectRatio="xMidYMid meet" viewBox={mark.viewBox} width={size}>
          <Path d={mark.path} fill={color} />
        </Svg>
      )}
    </View>
  );
}

type ResolvedMark =
  | {
      readonly kind: "bundled" | "glyph";
      readonly mark: { readonly path: string; readonly viewBox: string };
    }
  | { readonly kind: "generic"; readonly mark: null };

function resolveMark(iconKey: string, glyph: { readonly path: string } | null): ResolvedMark {
  const bundled = Object.hasOwn(BUNDLED_MARKS, iconKey) ? BUNDLED_MARKS[iconKey] : undefined;
  if (bundled !== undefined) {
    return { kind: "bundled", mark: bundled };
  }
  return glyph === null
    ? { kind: "generic", mark: null }
    : { kind: "glyph", mark: { path: glyph.path, viewBox: GLYPH_VIEW_BOX } };
}
