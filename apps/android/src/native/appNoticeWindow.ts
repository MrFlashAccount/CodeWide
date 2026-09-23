/** Web notices render in the existing document tree. */
export function setAppNoticeWindowVisible(_visible: boolean): void {}

/** The native notice window is available only on Android. */
export function isAppNoticeWindowAvailable(): boolean {
  return false;
}
