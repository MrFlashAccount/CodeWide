import { setStringAsync } from "expo-clipboard";
import { Linking } from "react-native";

export async function copyAccountLoginCode(value: string): Promise<void> {
  await setStringAsync(value);
}

export async function openAccountLoginUrl(value: string): Promise<void> {
  if (!(await Linking.canOpenURL(value))) throw new Error("Codex sign-in URL is unavailable");
  await Linking.openURL(value);
}
