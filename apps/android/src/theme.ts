/**
 * CodeWide presentation tokens.
 *
 * The dark scheme is the V1 product default. Both schemes intentionally use
 * Material 3 role names, but dynamic color remains off by default: any future
 * adapter must preserve the neutral primary and semantic-only color contract.
 */
export const darkScheme = {
  background: "#0F0F0F",
  onBackground: "#F2F2F2",
  surface: "#181818",
  onSurface: "#F2F2F2",
  surfaceContainerLowest: "#0F0F0F",
  surfaceContainerLow: "#181818",
  surfaceContainer: "#202020",
  surfaceContainerHigh: "#272727",
  surfaceContainerHighest: "#2B2B2B",
  onSurfaceVariant: "#B8B8B8",
  outline: "#2E2E2E",
  outlineVariant: "#2E2E2E",
  primary: "#E6E6E6",
  primaryPressed: "#B8B8B8",
  onPrimary: "#111111",
  primaryContainer: "#272727",
  onPrimaryContainer: "#F2F2F2",
  secondaryContainer: "#272727",
  onSecondaryContainer: "#F2F2F2",
  tertiaryContainer: "#202020",
  onTertiaryContainer: "#F2F2F2",
  error: "#F05D65",
  errorContainer: "#3B2022",
  onErrorContainer: "#FFDAD6",
  success: "#35C778",
  successContainer: "#173526",
  warning: "#E9872C",
  warningContainer: "#3A2818",
  code: "#121212",
  scrim: "rgba(0, 0, 0, 0.72)",
} as const;

export const lightScheme = {
  background: "#F6F6F6",
  onBackground: "#151515",
  surface: "#FFFFFF",
  onSurface: "#151515",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F2F2F2",
  surfaceContainer: "#EAEAEA",
  surfaceContainerHigh: "#E3E3E3",
  surfaceContainerHighest: "#DADADA",
  onSurfaceVariant: "#5E5E5E",
  outline: "#D0D0D0",
  outlineVariant: "#D0D0D0",
  primary: "#202020",
  primaryPressed: "#3A3A3A",
  onPrimary: "#FFFFFF",
  primaryContainer: "#E4E4E4",
  onPrimaryContainer: "#181818",
  secondaryContainer: "#E4E4E4",
  onSecondaryContainer: "#181818",
  tertiaryContainer: "#EAEAEA",
  onTertiaryContainer: "#151515",
  error: "#BA1A1A",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#187A47",
  successContainer: "#B8F3CC",
  warning: "#A9520E",
  warningContainer: "#FFE08A",
  code: "#F0F4F8",
  scrim: "rgba(0, 0, 0, 0.42)",
} as const;

// V1 remains dark-first. Components consume semantic aliases below; the
// native dynamic-color/light-theme switch can swap this source atomically.
const scheme = darkScheme;

export const colors = {
  ...scheme,
  text: scheme.onSurface,
  textMuted: scheme.onSurfaceVariant,
  textDim: "#858585",
  accent: scheme.primary,
  accentPressed: scheme.primaryPressed,
  accentMuted: scheme.primaryContainer,
  green: scheme.success,
  amber: scheme.warning,
  red: scheme.error,
  border: scheme.outlineVariant,
  borderSoft: "#242424",
  surfaceRaised: scheme.surfaceContainer,
  surfaceHover: scheme.surfaceContainerHigh,
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  small: 10,
  selected: 18,
  medium: 20,
  bubble: 22,
  bubbleTail: 7,
  large: 24,
  composer: 28,
  pill: 999,
} as const;

export const typeScale = {
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: "600" as const },
  titleMedium: { fontSize: 16, lineHeight: 22, fontWeight: "500" as const },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: "500" as const },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
} as const;

export const touchTarget = 48;
