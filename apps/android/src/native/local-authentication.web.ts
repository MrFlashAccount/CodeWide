import type { DeviceAuthenticationResult } from "./local-authentication.native";

export async function authenticateWithDevice(_promptMessage: string): Promise<DeviceAuthenticationResult> {
  return { success: false, message: "Biometric app lock is available in the native app." };
}
