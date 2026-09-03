import { setStringAsync } from "expo-clipboard";

export async function copyPreviewText(value: string): Promise<void> {
  await setStringAsync(value);
}
