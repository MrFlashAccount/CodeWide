import { StyleSheet, View } from "react-native";

import type { GetTransferAccess } from "../../data/private-transfer";
import { CompleteMarkdown } from "../../rendering/CompleteMarkdown";
import { MessageAttachmentCard } from "../../rendering/MessageAttachmentCard";
import { imageAttachmentPreviewId } from "../../rendering/user-message-attachments";
import { spacing } from "../../theme";
import type { MessageContent } from "./messageContent";

/**
 * Message body through the shared complete-document Markdown renderer
 * (code, Mermaid, HTML and images). Remote images resolve through the
 * nearest `PrivateImageAccessProvider`; attachments open with `getAccess`.
 */
export function MessageBody({
  content,
  getAccess,
}: {
  readonly content: MessageContent;
  readonly getAccess?: GetTransferAccess;
}): React.JSX.Element | null {
  const markdown = content.markdown.trim().length > 0;
  if (!markdown && content.attachments.length === 0) {
    return null;
  }
  return (
    <View style={styles.body}>
      {markdown ? <CompleteMarkdown source={content.markdown} /> : null}
      {content.attachments.length === 0 ? null : (
        <View style={styles.attachments}>
          {content.attachments.map((attachment, index) => (
            <MessageAttachmentCard
              attachment={attachment}
              key={imageAttachmentPreviewId(attachment.source, index)}
              {...(getAccess === undefined ? {} : { getAccess })}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  attachments: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  body: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: spacing.xs,
  },
});
