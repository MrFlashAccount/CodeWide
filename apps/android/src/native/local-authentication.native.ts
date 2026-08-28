import * as LocalAuthentication from "expo-local-authentication";

export type DeviceAuthenticationResult =
  | { success: true }
  | { success: false; message: string };

export async function authenticateWithDevice(promptMessage: string): Promise<DeviceAuthenticationResult> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware) {
    return { success: false, message: "Biometric authentication is not available on this device." };
  }
  if (!enrolled) {
    return { success: false, message: "Add a fingerprint or face in system settings first." };
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    fallbackLabel: "Use device passcode",
    disableDeviceFallback: false,
  });
  if (result.success) return { success: true };
  if (result.error === "user_cancel" || result.error === "system_cancel" || result.error === "app_cancel") {
    return { success: false, message: "Authentication cancelled." };
  }
  if (result.error === "lockout") {
    return { success: false, message: "Biometrics are temporarily locked. Use your device passcode." };
  }
  return { success: false, message: "Could not verify your identity." };
}
