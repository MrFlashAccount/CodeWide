import type { DeviceAuthenticationResult } from "./local-authentication.native";

export async function authenticateWithDevice(
  _promptMessage: string,
): Promise<DeviceAuthenticationResult> {
  await Promise.resolve();
  return {
    message: "Biometric app lock is available in the native app.",
    success: false,
  };
}
