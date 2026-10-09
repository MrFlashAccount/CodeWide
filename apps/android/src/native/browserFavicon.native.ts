import { NativeModules } from "react-native";

const MAX_ICON_DATA_LENGTH = 22_000;

/** Returns only a bounded engine-provided PNG; older APKs have no favicon bridge. */
export async function readBrowserFavicon(target: number, url: string): Promise<string | null> {
  const bridge: unknown = NativeModules.CodeWideNative;
  if (
    typeof bridge !== "object" ||
    bridge === null ||
    !("readBrowserFavicon" in bridge) ||
    typeof bridge.readBrowserFavicon !== "function"
  ) {
    return null;
  }
  const value: unknown = await Reflect.apply(bridge.readBrowserFavicon, bridge, [target, url]);
  return typeof value === "string" &&
    value.length <= MAX_ICON_DATA_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : null;
}
