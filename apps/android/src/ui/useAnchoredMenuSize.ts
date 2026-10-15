import { useWindowDimensions } from "react-native";

const MENU_MIN_DIMENSION = 1;
const MENU_MAX_WIDTH = 400;
const MENU_WIDTH_GUTTER = 24;
const MENU_MAX_HEIGHT = 440;
const MENU_HEIGHT_GUTTER = 96;

/** The width and height bound of an anchored list menu on the current window. */
export function useAnchoredMenuSize(): { readonly maxHeight: number; readonly width: number } {
  const { height, width } = useWindowDimensions();
  return {
    maxHeight: Math.max(MENU_MIN_DIMENSION, Math.min(MENU_MAX_HEIGHT, height - MENU_HEIGHT_GUTTER)),
    width: Math.max(MENU_MIN_DIMENSION, Math.min(MENU_MAX_WIDTH, width - MENU_WIDTH_GUTTER)),
  };
}
