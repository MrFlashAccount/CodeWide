import type { SelectedUpload } from "./file-transfer";

/** Photos chosen in the system Photo Picker; a dismissed picker selects nothing. */
export type PhotoSelection =
  | { readonly status: "cancelled" }
  | { readonly status: "selected"; readonly uploads: readonly SelectedUpload[] };

/** A photo taken with the system camera, or the reason none could be taken. */
export type CameraCapture =
  | PhotoSelection
  | { readonly canAskAgain: boolean; readonly status: "permission-denied" };
