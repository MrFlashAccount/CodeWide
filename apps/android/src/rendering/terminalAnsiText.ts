/**
 * Projects terminal ANSI/SGR output into plain text runs with their style,
 * the React counterpart of the Android `NativeAnsiProjector`: SGR colors and
 * text attributes survive, while cursor, device and OSC control sequences are
 * removed so untrusted output cannot affect the UI.
 */

/** The SGR attributes in effect for a run; colors are `#rrggbb`, null for the default. */
export type TerminalStyle = {
  readonly background: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly foreground: string | null;
  readonly hidden: boolean;
  readonly inverse: boolean;
  readonly italic: boolean;
  readonly strikethrough: boolean;
  readonly underline: boolean;
};

/** One run of text drawn in one style; `start` is its offset in the projected text. */
export type TerminalRun = {
  readonly start: number;
  readonly style: TerminalStyle;
  readonly text: string;
};

/** The runs of a projected text and the style in effect after its last character. */
export type TerminalProjection = {
  readonly endStyle: TerminalStyle;
  readonly runs: readonly TerminalRun[];
};

/** The style before any SGR sequence. */
export const DEFAULT_TERMINAL_STYLE: TerminalStyle = {
  background: null,
  bold: false,
  dim: false,
  foreground: null,
  hidden: false,
  inverse: false,
  italic: false,
  strikethrough: false,
  underline: false,
};

const ANSI_COLORS = [
  "#1d1f21",
  "#cc6666",
  "#b5bd68",
  "#f0c674",
  "#81a2be",
  "#b294bb",
  "#8abeb7",
  "#c5c8c6",
] as const;

const ANSI_BRIGHT_COLORS = [
  "#969896",
  "#de935f",
  "#8c9440",
  "#f0c674",
  "#81a2be",
  "#85678f",
  "#5e8d87",
  "#ffffff",
] as const;

/** SGR codes that select a palette color: the first code of each run of eight. */
const FOREGROUND_BASE = 30;
const BACKGROUND_BASE = 40;
const BRIGHT_FOREGROUND_BASE = 90;
const BRIGHT_BACKGROUND_BASE = 100;
/** SGR codes followed by an extended (256-color or RGB) color. */
const EXTENDED_FOREGROUND = 38;
const EXTENDED_BACKGROUND = 48;
const EXTENDED_PALETTE_MODE = 5;
const EXTENDED_RGB_MODE = 2;

/** The xterm 256-color palette: 16 named colors, a 6×6×6 cube, then a gray ramp. */
const PALETTE_CUBE_START = 16;
const PALETTE_GRAY_START = 232;
const PALETTE_SIZE = 256;
const CUBE_SIDE = 6;
const CUBE_CHANNEL_BASE = 55;
const CUBE_CHANNEL_STEP = 40;
const GRAY_BASE = 8;
const GRAY_STEP = 10;
const MAX_CHANNEL = 255;
const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;
const RGB_CHANNELS = 3;
const DECIMAL_RADIX = 10;

type StyleEffect = (style: TerminalStyle) => TerminalStyle;

/** The effect of every SGR code that needs no argument, by code. */
const ATTRIBUTE_EFFECTS: Readonly<Record<string, StyleEffect>> = {
  "0": () => DEFAULT_TERMINAL_STYLE,
  "1": (style) => ({ ...style, bold: true, dim: false }),
  "2": (style) => ({ ...style, bold: false, dim: true }),
  "21": (style) => ({ ...style, underline: true }),
  "22": (style) => ({ ...style, bold: false, dim: false }),
  "23": (style) => ({ ...style, italic: false }),
  "24": (style) => ({ ...style, underline: false }),
  "27": (style) => ({ ...style, inverse: false }),
  "28": (style) => ({ ...style, hidden: false }),
  "29": (style) => ({ ...style, strikethrough: false }),
  "3": (style) => ({ ...style, italic: true }),
  "39": (style) => ({ ...style, foreground: null }),
  "4": (style) => ({ ...style, underline: true }),
  "49": (style) => ({ ...style, background: null }),
  "7": (style) => ({ ...style, inverse: true }),
  "8": (style) => ({ ...style, hidden: true }),
  "9": (style) => ({ ...style, strikethrough: true }),
};

const SGR_EFFECTS: ReadonlyMap<number, StyleEffect> = new Map<number, StyleEffect>([
  ...Object.entries(ATTRIBUTE_EFFECTS).map(([code, effect]) => [Number(code), effect] as const),
  ...paletteEffects(FOREGROUND_BASE, ANSI_COLORS, "foreground"),
  ...paletteEffects(BACKGROUND_BASE, ANSI_COLORS, "background"),
  ...paletteEffects(BRIGHT_FOREGROUND_BASE, ANSI_BRIGHT_COLORS, "foreground"),
  ...paletteEffects(BRIGHT_BACKGROUND_BASE, ANSI_BRIGHT_COLORS, "background"),
]);

function paletteEffects(
  base: number,
  palette: readonly string[],
  channel: "background" | "foreground",
): (readonly [number, StyleEffect])[] {
  return palette.map((color, index) => [base + index, (style) => ({ ...style, [channel]: color })]);
}

/**
 * One lexical unit of terminal output: a complete CSI sequence (payload,
 * final byte), an unterminated one, an OSC or string control, another ESC
 * command, a carriage return, printable text, or any other control.
 */
const TERMINAL_TOKEN =
  // oxlint-disable-next-line no-control-regex -- WHY: the projector exists to recognize terminal control bytes.
  /(?:\u001B\[|\u009B)([^@-~]*)([@-~])|(?:\u001B\[|\u009B)[^@-~]*$|\u001B\][\s\S]*?(?:\u0007|\u001B\\|$)|\u001B[PX^_][\s\S]*?(?:\u001B\\|$)|\u001B[\s\S]?|(\r\n?)|([^\u0000-\u0008\u000A-\u001F\u007F\u009B]+|\n)|[\s\S]/gu;

/**
 * Projects `source`, starting in `initialStyle`; a text split into several
 * projections continues each from the previous one's `endStyle`.
 */
export function projectTerminalText(
  source: string,
  initialStyle: TerminalStyle = DEFAULT_TERMINAL_STYLE,
): TerminalProjection {
  const runs: TerminalRun[] = [];
  let style = initialStyle;
  let length = 0;
  const append = (text: string): void => {
    const previous = runs.at(-1);
    if (previous?.style === style) {
      runs[runs.length - 1] = { start: previous.start, style, text: previous.text + text };
    } else {
      runs.push({ start: length, style, text });
    }
    length += text.length;
  };
  for (const [, payload, final, carriageReturn, printable] of source.matchAll(TERMINAL_TOKEN)) {
    if (final === "m") {
      style = applySgr(style, payload ?? "");
    } else if (carriageReturn !== undefined) {
      // A bare carriage return redraws a line; a transcript shows the new line below.
      append("\n");
    } else if (printable !== undefined) {
      append(printable);
    }
  }
  return { endStyle: style, runs };
}

/** The SGR codes of a payload; an empty payload resets. */
function sgrCodes(payload: string): readonly number[] {
  if (payload.trim() === "") {
    return [0];
  }
  return payload.split(";").flatMap((group) => {
    if (!group.includes(":")) {
      const code = Number.parseInt(group, DECIMAL_RADIX);
      return [Number.isNaN(code) ? 0 : code];
    }
    const values = group
      .split(":")
      .map((value) => Number.parseInt(value, DECIMAL_RADIX))
      .filter((value) => !Number.isNaN(value));
    // Colon notation carries extended colors (38:2::r:g:b); an underline
    // variant such as 4:3 has a subtype that is not another SGR code.
    return isExtendedColorCode(values[0]) ? values : values.slice(0, 1);
  });
}

function isExtendedColorCode(code: number | undefined): boolean {
  return code === EXTENDED_FOREGROUND || code === EXTENDED_BACKGROUND;
}

function applySgr(current: TerminalStyle, payload: string): TerminalStyle {
  const codes = sgrCodes(payload);
  let style = current;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    const extended = isExtendedColorCode(code) ? extendedColor(codes, index + 1) : null;
    if (extended === null) {
      style = SGR_EFFECTS.get(code)?.(style) ?? style;
    } else {
      style =
        code === EXTENDED_FOREGROUND
          ? { ...style, foreground: extended.color }
          : { ...style, background: extended.color };
      index = extended.lastIndex;
    }
  }
  return style;
}

function extendedColor(
  codes: readonly number[],
  start: number,
): { readonly color: string; readonly lastIndex: number } | null {
  const mode = codes[start];
  if (mode === EXTENDED_PALETTE_MODE) {
    const value = codes[start + 1];
    return value === undefined
      ? null
      : { color: xtermColor(clamp(value, PALETTE_SIZE - 1)), lastIndex: start + 1 };
  }
  if (mode !== EXTENDED_RGB_MODE) {
    return null;
  }
  const [red, green, blue] = codes.slice(start + 1, start + 1 + RGB_CHANNELS);
  return red === undefined || green === undefined || blue === undefined
    ? null
    : { color: rgb(red, green, blue), lastIndex: start + RGB_CHANNELS };
}

function xtermColor(index: number): string {
  if (index < ANSI_COLORS.length) {
    return ANSI_COLORS[index] ?? ANSI_COLORS[0];
  }
  if (index < PALETTE_CUBE_START) {
    return ANSI_BRIGHT_COLORS[index - ANSI_COLORS.length] ?? ANSI_BRIGHT_COLORS[0];
  }
  if (index < PALETTE_GRAY_START) {
    const offset = index - PALETTE_CUBE_START;
    return rgb(
      cubeChannel(Math.floor(offset / (CUBE_SIDE * CUBE_SIDE))),
      cubeChannel(Math.floor(offset / CUBE_SIDE) % CUBE_SIDE),
      cubeChannel(offset % CUBE_SIDE),
    );
  }
  const gray = GRAY_BASE + (index - PALETTE_GRAY_START) * GRAY_STEP;
  return rgb(gray, gray, gray);
}

function cubeChannel(value: number): number {
  return value === 0 ? 0 : CUBE_CHANNEL_BASE + value * CUBE_CHANNEL_STEP;
}

function rgb(red: number, green: number, blue: number): string {
  return `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}`;
}

function hexChannel(value: number): string {
  return clamp(value, MAX_CHANNEL).toString(HEX_RADIX).padStart(HEX_CHANNEL_DIGITS, "0");
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}
