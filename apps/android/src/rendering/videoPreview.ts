export const MESSAGE_VIDEO_PREVIEW_HEIGHT = 180;
export const MESSAGE_VIDEO_PREVIEW_WIDTH = 320;

export function isAttachmentVideo(name: string): boolean {
  return /\.(?:mp4|m4v|mov|webm|mkv)$/iu.test(name);
}
