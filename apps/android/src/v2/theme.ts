/**
 * CodeWide presentation tokens.
 *
 * The dark scheme is the V1 product default. It intentionally uses Material 3
 * role names while dynamic color remains off: any future adapter must preserve
 * the neutral primary and semantic-only color contract.
 */
const darkScheme = {
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

// V2 deliberately inherits V1's dark-only product surface.
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
  optical: 2,
  meter: 3,
  xxs: 4,
  composerRow: 6,
  xs: 8,
  composerInputBottom: 10,
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
  menu: 30, // HeroUI --radius-3xl with CodeWide's 10dp base radius.
  composer: 28,
  pill: 999,
} as const;

export const typeWeight = {
  medium: "500",
  regular: "400",
  semibold: "600",
} as const;

export const typeTracking = {
  caps: 0.7,
} as const;

export const typeScale = {
  heading: { fontSize: 22, lineHeight: 28, fontWeight: typeWeight.semibold },
  title: { fontSize: 16, lineHeight: 22, fontWeight: typeWeight.semibold },
  body: { fontSize: 14, lineHeight: 20, fontWeight: typeWeight.regular },
  composerInput: { fontSize: 15, lineHeight: 21 },
  voiceLabel: { fontSize: 13 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: typeWeight.medium },
  caption: { fontSize: 10, lineHeight: 14, fontWeight: typeWeight.medium },
  code: {
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: typeWeight.regular,
    lineHeight: 20,
  },
  emoji: { fontSize: 22, lineHeight: 28 },
} as const;

export const touchTarget = 48;
