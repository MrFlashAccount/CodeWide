import type { ComponentType } from "react";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./ToolContent.styles";
import type { ProtocolBodyProps } from "./ToolContent.types";

/** Presents argument and progress sections through the coupled bounded protocol renderer. */
export function renderToolArguments(
  argumentsText: string,
  progress: string[],
  ProtocolBody: ComponentType<ProtocolBodyProps>,
) {
  return (
    <>
      <Text style={styles.controlSectionLabel}>Arguments</Text>
      <ProtocolBody body={argumentsText} code collapsible section="arguments" />
      {progress.length > 0 && (
        <>
          <Text style={styles.controlSectionLabel}>Progress</Text>
          <ProtocolBody
            body={progress.map((entry) => `• ${entry}`).join("\n")}
            code={false}
            collapsible
            section="progress"
          />
        </>
      )}
    </>
  );
}
