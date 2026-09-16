import * as LocalAuthentication from "expo-local-authentication";

export type DeviceAuthenticationResult = { success: true } | { message: string; success: false };

export async function authenticateWithDevice(
  promptMessage: string,
): Promise<DeviceAuthenticationResult> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware) {
    return { message: "Biometric authentication is not available on this device.", success: false };
  }
  if (!enrolled) {
    return { message: "Add a fingerprint or face in system settings first.", success: false };
  }
  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use device passcode",
    promptMessage,
  });
  if (result.success) {
    return { success: true };
  }
  if (
    result.error === "user_cancel" ||
    result.error === "system_cancel" ||
    result.error === "app_cancel"
  ) {
    return { message: "Authentication cancelled.", success: false };
  }
  if (result.error === "lockout") {
    return {
      message: "Biometrics are temporarily locked. Use your device passcode.",
      success: false,
    };
  }
  return { message: "Could not verify your identity.", success: false };
}
