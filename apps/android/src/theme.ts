/**
 * CodeWide presentation tokens.
 *
 * The dark scheme is the V1 product default. Both schemes intentionally use
 * Material 3 role names, but dynamic color remains off by default: any future
 * adapter must preserve the neutral primary and semantic-only color contract.
 */
export const darkScheme = {
  background: "#0F0F0F",
  code: "#121212",
  error: "#F05D65",
  errorContainer: "#3B2022",
  onBackground: "#F2F2F2",
  onErrorContainer: "#FFDAD6",
  onPrimary: "#111111",
  onPrimaryContainer: "#F2F2F2",
  onSecondaryContainer: "#F2F2F2",
  onSurface: "#F2F2F2",
  onSurfaceVariant: "#B8B8B8",
  onTertiaryContainer: "#F2F2F2",
  outline: "#2E2E2E",
  outlineVariant: "#2E2E2E",
  primary: "#E6E6E6",
  primaryContainer: "#272727",
  primaryPressed: "#B8B8B8",
  scrim: "rgba(0, 0, 0, 0.72)",
  secondaryContainer: "#272727",
  success: "#35C778",
  successContainer: "#173526",
  surface: "#181818",
  surfaceContainer: "#202020",
  surfaceContainerHigh: "#272727",
  surfaceContainerHighest: "#2B2B2B",
  surfaceContainerLow: "#181818",
  surfaceContainerLowest: "#0F0F0F",
  tertiaryContainer: "#202020",
  warning: "#E9872C",
  warningContainer: "#3A2818",
} as const;

// V1 remains dark-first. Components consume semantic aliases below; the
// native dynamic-color/light-theme switch can swap this source atomically.
const scheme = darkScheme;

export const colors = {
  ...scheme,
  accent: scheme.primary,
  accentMuted: scheme.primaryContainer,
  accentPressed: scheme.primaryPressed,
  amber: scheme.warning,
  border: scheme.outlineVariant,
  borderSoft: "#242424",
  conversationSurface: scheme.surface,
  green: scheme.success,
  menuHighlight: "#333333",
  menuSurface: "#1E1E1E",
  messageSurface: scheme.background,
  nebula: "#1a73f2",
  nebulaHighlight: "#fcffff",
  red: scheme.error,
  surfaceHover: scheme.surfaceContainerHigh,
  surfaceRaised: scheme.surfaceContainer,
  text: scheme.onSurface,
  textDim: "#858585",
  textMuted: scheme.onSurfaceVariant,
  threadListSurface: scheme.background,
} as const;

export const spacing = {
  compact: 6,
  inputInset: 10,
  lg: 24,
  md: 16,
  optical: 2,
  sm: 12,
  xl: 32,
  xs: 8,
  xxs: 4,
} as const;

export const radii = {
  bubble: 24,
  bubbleTail: 8,
  compact: 4,
  composer: 24,
  large: 24,
  medium: 16,
  menu: 32,
  pill: 999,
  selected: 16,
  small: 8,
} as const;

export const typeWeight = {
  medium: "500",
  regular: "400",
  semibold: "600",
} as const;

export const typeTracking = { caps: 0.7, pairingCode: 1.5 } as const;

export const typeScale = {
  body: { fontSize: 14, fontWeight: typeWeight.regular, lineHeight: 20 },
  caption: { fontSize: 10, fontWeight: typeWeight.medium, lineHeight: 14 },
  code: { fontFamily: "monospace", fontSize: 13, fontWeight: typeWeight.regular, lineHeight: 20 },
  composerInput: { fontSize: 15, fontWeight: typeWeight.regular, lineHeight: 21 },
  emoji: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 22, fontWeight: typeWeight.semibold, lineHeight: 28 },
  label: { fontSize: 12, fontWeight: typeWeight.medium, lineHeight: 16 },
  title: { fontSize: 16, fontWeight: typeWeight.semibold, lineHeight: 22 },
  voiceLabel: { fontSize: 13, fontWeight: typeWeight.medium, lineHeight: 20 },
} as const;

export const touchTarget = 48;

/** Glyph size is independent of the surrounding touch target. */
export const iconSize = {
  action: 20,
  illustration: 32,
  indicator: 12,
  inline: 16,
  navigation: 24,
} as const;

/** Compact controls retain explicit hit slop when their visual bounds are below 48dp. */
export const controlSize = {
  compact: 32,
  regular: 40,
  touch: touchTarget,
} as const;

/** Panel and list geometry is independent of button size. Text-bearing rows may grow. */
export const layoutSize = {
  attachmentTile: 200,
  header: 56,
  metadataRow: 24,
  row: 64,
} as const;

/** Extra target area for isolated compact controls; never replaces adequate parent bounds. */
export const controlHitSlop = {
  compact: (touchTarget - controlSize.compact) / 2,
  regular: (touchTarget - controlSize.regular) / 2,
  touch: 0,
} as const;
