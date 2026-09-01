import { getStringAsync } from "expo-clipboard";

export async function readPairingClipboard(): Promise<string> {
  return getStringAsync();
}
