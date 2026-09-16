/** Attachment display data; platform adapters own all icon rendering. */
export interface AttachmentListRowProps {
  accessibilityLabel: string;
  description: string;
  leading: "image" | "audio" | "file";
  onPress: () => void;
  position: "only" | "first" | "middle" | "last";
  title: string;
  trailing?: "open" | "download" | undefined;
}
