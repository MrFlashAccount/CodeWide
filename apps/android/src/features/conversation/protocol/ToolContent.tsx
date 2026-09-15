import { renderToolArguments } from "./ToolArguments";
import { renderProtocolBodyView } from "./ProtocolBodyView";
import type {
  LazyJsonProtocolBodyInput,
  ProtocolBodyInput,
  ToolCallProtocolBlockInput,
  ToolCallProtocolDetailsInput,
  ToolCallResultContentInput,
  ToolResourceLinkInput,
  ToolRichContentInput,
} from "./ToolContent.inputs";
import { renderToolRichItems } from "./ToolRichItems";
/** V1 ToolContent owner, extracted without changing interaction or resource lifetime. */
import { useContext } from "react";
import { Linking, Pressable } from "react-native";
import { boundedJsonStringify } from "../../../rendering/bounded-json";
import { isSafeHttpUrl } from "../../../rendering/http-link";
import { collapsedCodePreview } from "../../../rendering/native-code-block";
import { formatDuration } from "../../../ui/number-format";
import { AppText as Text } from "../../../ui/Typography";
import { EXPANDED_BODY_CHARS } from "../content/contentLimits";
import { Card, usePersistentExpansion } from "../turns/Card";
import { COLLAPSED_BODY_CHARS } from "../turns/disclosureState";
import { ActiveToolCallContext, ExpansionItemKeyContext } from "../turns/turnContexts";
import { protocolCopyText } from "./protocolCopyText";
import { recordValue } from "./protocolValue";
import { styles } from "./ToolContent.styles";

export const TOOL_RESULT_MAX_HEIGHT = 400;

export function ToolCallProtocolBlock({ block, getTransferAccess }: ToolCallProtocolBlockInput) {
  return (
    <Card
      title={block.title}
      icon="extension-puzzle-outline"
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <ToolCallProtocolDetails
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

export function ToolCallProtocolDetails(props: ToolCallProtocolDetailsInput) {
  const argumentsText = boundedJsonStringify(props.block.raw.arguments ?? null);
  const progress = Array.isArray(props.block.raw.progress)
    ? props.block.raw.progress.filter((entry): entry is string => typeof entry === "string")
    : [];
  return (
    <>
      {renderToolArguments(argumentsText, progress, ProtocolBody)}
      <Text style={styles.controlSectionLabel}>Result</Text>
      <ToolCallResultContent
        block={props.block}
        section="result"
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
      />
      {props.block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(props.block.durationMs)}</Text>
      )}
    </>
  );
}

export function ToolCallResultContent(props: ToolCallResultContentInput) {
  if (props.block.kind === "dynamicToolCall") {
    const items = Array.isArray(props.block.raw.contentItems) ? props.block.raw.contentItems : [];
    return items.length === 0 ? (
      <LazyJsonProtocolBody value={{ success: props.block.raw.success }} section={props.section} />
    ) : (
      <ToolRichContent
        items={items}
        section={props.section}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
      />
    );
  }
  if (props.block.raw.error !== null && props.block.raw.error !== undefined)
    return <LazyJsonProtocolBody value={props.block.raw.error} section={props.section} />;
  const result = recordValue(props.block.raw.result);
  const items = Array.isArray(result.content) ? result.content : [];
  const appContext = recordValue(props.block.raw.appContext);
  const resourceUri = typeof appContext.resourceUri === "string" ? appContext.resourceUri : null;
  return (
    <>
      {resourceUri !== null && (
        <ToolResourceLink
          uri={resourceUri}
          label={typeof appContext.appName === "string" ? appContext.appName : "MCP App resource"}
        />
      )}
      {items.length > 0 ? (
        <ToolRichContent
          items={items}
          section={props.section}
          {...(props.getTransferAccess === undefined
            ? {}
            : { getTransferAccess: props.getTransferAccess })}
        />
      ) : result.structuredContent === undefined ? (
        <LazyJsonProtocolBody value={props.block.raw.result ?? null} section={props.section} />
      ) : null}
      {result.structuredContent !== null && result.structuredContent !== undefined && (
        <>
          <Text style={styles.controlSectionLabel}>Structured result</Text>
          <ProtocolBody
            body={boundedJsonStringify(result.structuredContent)}
            code
            collapsible
            expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
            section="structured-result"
          />
        </>
      )}
    </>
  );
}

export function ToolRichContent({ items, section, getTransferAccess }: ToolRichContentInput) {
  return renderToolRichItems(items, section, getTransferAccess, {
    ProtocolBody,
    LazyJsonProtocolBody,
    ToolResourceLink,
    toolTextNeedsCodeViewport,
    containsTerminalControlSequences,
    maxHeight: TOOL_RESULT_MAX_HEIGHT,
  });
}

export function toolTextNeedsCodeViewport(value: string): boolean {
  const lines = value.split("\n");
  if (lines.some((line) => line.length > 96 || line.includes("\t"))) return true;
  if (
    /^(?:\s*[\[{]|\s*(?:diff --git|@@ |Traceback |Exception\b|Error:|stdout:|stderr:))/mu.test(
      value,
    )
  )
    return true;
  return false;
}

export function containsTerminalControlSequences(value: string): boolean {
  return value.includes("\u001b[") || value.includes("\u009b") || value.includes("\u001b]");
}

export function ToolResourceLink({ uri, label }: ToolResourceLinkInput) {
  const canOpen = isSafeHttpUrl(uri);
  return (
    <Pressable
      disabled={!canOpen}
      onPress={canOpen ? () => void Linking.openURL(uri) : undefined}
      style={styles.searchResult}
    >
      <Text numberOfLines={1} style={styles.menuActionTitle}>
        {label}
      </Text>
      <Text selectable numberOfLines={2} style={styles.rawLink}>
        {uri}
      </Text>
    </Pressable>
  );
}

export function LazyJsonProtocolBody({ value, section = "body" }: LazyJsonProtocolBodyInput) {
  return <ProtocolBody body={boundedJsonStringify(value)} code collapsible section={section} />;
}

export function ProtocolBody({
  body,
  code,
  collapsible,
  expandedMaxHeight,
  section = "body",
  language = "text",
  codeVariant = "code",
  showCopyAction = true,
}: ProtocolBodyInput) {
  const itemKey = useContext(ExpansionItemKeyContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const collapsedLines = code ? 3 : 2;
  const bodyLines = body === "" ? 0 : body.split("\n").length;
  const canCollapse =
    collapsible && (body.length > COLLAPSED_BODY_CHARS || bodyLines > collapsedLines);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:body:${section}`, false);
  const limit = expanded ? EXPANDED_BODY_CHARS : COLLAPSED_BODY_CHARS;
  const bounded =
    expanded && body.length > limit
      ? `${body.slice(0, limit)}\n…`
      : activeToolCall && !expanded && canCollapse
        ? `…\n${body.slice(-COLLAPSED_BODY_CHARS)}`
        : body;
  const rendered =
    code && !expanded && canCollapse
      ? collapsedCodePreview(bounded, collapsedLines, activeToolCall)
      : bounded;
  return renderProtocolBodyView({
    body,
    code,
    expandedMaxHeight,
    section,
    language,
    codeVariant,
    showCopyAction,
    rendered,
    expanded,
    canCollapse,
    collapsedLines,
    activeToolCall,
    itemKey,
    bodyLines,
    setExpanded,
    maxHeight: TOOL_RESULT_MAX_HEIGHT,
  });
}
