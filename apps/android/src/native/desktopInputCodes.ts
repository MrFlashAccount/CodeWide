const androidA = 29;
const androidD = 32;
const androidDown = 20;
const androidEnter = 66;
const androidEscape = 111;
const androidF = 34;
const androidF10 = 140;
const androidF11 = 141;
const androidF8 = 138;
const androidLeft = 21;
const androidP = 44;
const androidRight = 22;
const androidS = 47;
const androidTab = 61;
const androidUp = 19;
const androidW = 51;
const androidAlt = 4;
const androidCtrl = 1;
const androidShift = 2;
const mouseLeft = 1;
const androidMiddle = 4;
const mouseRight = 2;
/** Android KeyEvent codes used by the local desktop control profiles. */
export const desktopKeyCodes = {
  a: androidA,
  d: androidD,
  down: androidDown,
  enter: androidEnter,
  escape: androidEscape,
  f: androidF,
  f10: androidF10,
  f11: androidF11,
  f8: androidF8,
  left: androidLeft,
  p: androidP,
  right: androidRight,
  s: androidS,
  tab: androidTab,
  up: androidUp,
  w: androidW,
} as const;
/** Compact modifier mask shared with the native input adapter. */
export const desktopModifierBits = {
  alt: androidAlt,
  ctrl: androidCtrl,
  shift: androidShift,
} as const;
/** Android MotionEvent button mask. */
export const desktopMouseButtons = {
  left: mouseLeft,
  middle: androidMiddle,
  right: mouseRight,
} as const;
/** Relative cursor gain when precision mode is selected. */
export const desktopPrecisionGain = 0.35;
