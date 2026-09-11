/** Attachment display data; platform adapters own all icon rendering. */
export interface AttachmentListRowProps {
  title: string;
  description: string;
  accessibilityLabel: string;
  position: "only" | "first" | "middle" | "last";
  leading: "image" | "audio" | "file";
  trailing?: "open" | "download" | undefined;
  onPress(): void;
}
