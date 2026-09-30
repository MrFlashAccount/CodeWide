/** Strict project-owned surface for the raw-TypeScript expo-pretext package entry. */
export type TextStyle = Readonly<{
  fontFamily: string | readonly string[];
  fontSize: number;
  fontStyle?: "italic" | "normal";
  fontWeight?: "400" | "500" | "600" | "700" | "bold" | "normal";
  letterSpacing?: number;
  lineHeight?: number;
}>;

export type PreparedText = Readonly<{ readonly preparedText: unique symbol }>;

export type InlineFlowItem = Readonly<{
  atomic?: boolean;
  extraWidth?: number;
  style: TextStyle;
  text: string;
}>;

export type PreparedInlineFlow = Readonly<{ readonly preparedInlineFlow: unique symbol }>;

export type InlineFlowFragment = Readonly<{
  end: Readonly<{ graphemeIndex: number; segmentIndex: number }>;
  gapBefore: number;
  itemIndex: number;
  occupiedWidth: number;
  start: Readonly<{ graphemeIndex: number; segmentIndex: number }>;
  text: string;
}>;

export type InlineFlowLine = Readonly<{
  end: Readonly<{ graphemeIndex: number; itemIndex: number; segmentIndex: number }>;
  fragments: readonly InlineFlowFragment[];
  width: number;
}>;

export type FontLoadVerification = Readonly<{
  applied: boolean;
  isSystemFont: boolean;
  requestedWidth: number;
  resolvedFamily: string;
  systemWidth: number;
  widthDifference: number;
}>;

export function layout(
  prepared: PreparedText,
  maxWidth: number,
  lineHeight?: number,
): Readonly<{ height: number; lineCount: number }>;

export function prepare(
  text: string,
  style: TextStyle,
  options?: Readonly<{ accuracy?: "exact" | "fast" }>,
): PreparedText;

export function prepareInlineFlow(items: readonly InlineFlowItem[]): PreparedInlineFlow;

export function measureInlineFlow(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  lineHeight: number,
): Readonly<{ height: number; lineCount: number }>;

export function walkInlineFlowLines(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  onLine: (line: InlineFlowLine) => void,
): number;

export function validateFont(family: string | readonly string[]): boolean;

export function verifyFontsLoaded(
  style: TextStyle,
  options?: Readonly<{ reference?: string; widthTolerance?: number }>,
): FontLoadVerification | null;
