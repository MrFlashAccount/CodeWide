import { reloadAsync } from "expo-updates";

export async function restartApplication(): Promise<void> {
  await reloadAsync();
}
