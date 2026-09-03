import { Linking } from "react-native";

/** Opens only ordinary HTTP(S) links; private and loopback resources use separate capabilities. */
export async function openExternalMarkdownLink(value: string): Promise<void> {
  const url = safeExternalUrl(value);
  if (url === null) throw new Error("External link is not safe to open");
  if (!(await Linking.canOpenURL(url))) throw new Error("External link is unavailable");
  await Linking.openURL(url);
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
