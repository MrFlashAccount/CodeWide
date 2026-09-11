import { LegendList } from "@legendapp/list/react-native";
import { useId, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { SearchContextMessage, SearchContextPage, SearchContextQuery } from "../data/message-search";
import type { RemoteWorkspace } from "../data/use-remote-workspace";
import { useEvent } from "../react/useEvent";
import { useEphemeralAsyncResource } from "../rendering/async-resource-store";
import { RichMarkdown } from "../rendering/RichMarkdown";
import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { WaveText } from "../ui/WaveText";
import type { LocatedSearchHit } from "./GlobalSearchScreen";

interface ContextProps {
  readonly remote: Pick<RemoteWorkspace, "searchContext">;
  readonly target: LocatedSearchHit;
  readonly query: string;
  readonly onBack: () => void;
  readonly onOpenThread: () => void;
}

/** A read-only historical viewport cannot overwrite an active streaming projection. */
export function SearchContextScreen(props: ContextProps) {
  const instance = useId();
  const [request, setRequest] = useState<SearchContextQuery>({ threadId: props.target.hit.threadId, messageId: props.target.hit.messageId, direction: "around" });
  const resource = useEphemeralAsyncResource<SearchContextPage>(`search-context:${instance}`, JSON.stringify(request), async () => await props.remote.searchContext(props.target.connectionId, request));
  const older = useEvent(() => { if (resource.value?.older !== null && resource.value?.older !== undefined) setRequest({ ...request, messageId: resource.value.older, direction: "older" }); });
  const newer = useEvent(() => { if (resource.value?.newer !== null && resource.value?.newer !== undefined) setRequest({ ...request, messageId: resource.value.newer, direction: "newer" }); });
  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable onPress={props.onBack} style={styles.button}><Text style={styles.label}>Back to search</Text></Pressable>
      <Text style={styles.title} numberOfLines={1}>{props.target.hit.title}</Text>
      <Pressable onPress={props.onOpenThread} style={styles.button}><Text style={styles.label}>Open live chat</Text></Pressable>
    </View>
    <Text style={styles.notice}>Message history · {props.query}</Text>
    {resource.status === "loading" && <WaveText text="Loading message context" style={styles.notice} />}
    {resource.error !== null && <Text style={styles.error}>This search position is unavailable. Refresh the search. {resource.error}</Text>}
    {resource.status !== "loading" && resource.value !== null && resource.value !== undefined && <LegendList key={request.messageId + request.direction} data={resource.value.messages} keyExtractor={messageKey}
      renderItem={(entry) => <ContextMessage message={entry.item} selected={entry.item.messageId === props.target.hit.messageId} />}
      initialScrollIndex={Math.max(0, resource.value?.messages.findIndex((message) => message.messageId === props.target.hit.messageId) ?? 0)}
      style={styles.list} recycleItems />}
    <View style={styles.header}>
      {resource.value?.older !== null && resource.value?.older !== undefined && <Pressable onPress={older} style={styles.button}><Text style={styles.label}>Older messages</Text></Pressable>}
      {resource.value?.newer !== null && resource.value?.newer !== undefined && <Pressable onPress={newer} style={styles.button}><Text style={styles.label}>Newer messages</Text></Pressable>}
    </View>
  </View>;
}

interface MessageProps { readonly message: SearchContextMessage; readonly selected: boolean }
function ContextMessage(props: MessageProps) {
  return <View style={[styles.message, props.message.kind === "user_message" && styles.user, props.selected && styles.selected]}>
    <RichMarkdown source={props.message.text} />
    <Text style={styles.notice}>{new Date(props.message.timestamp).toLocaleString()}</Text>
  </View>;
}
function messageKey(message: SearchContextMessage): string { return String(message.messageId); }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, list: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, padding: spacing.sm },
  button: { padding: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surface },
  title: { flex: 1, minWidth: 0, ...typeScale.body, color: colors.text }, label: { ...typeScale.caption, color: colors.text },
  notice: { ...typeScale.caption, color: colors.textMuted, margin: spacing.sm }, error: { ...typeScale.caption, color: colors.error, margin: spacing.md },
  message: { margin: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.bubble, borderWidth: 1, borderColor: "transparent" },
  user: { marginLeft: spacing.xl }, selected: { borderColor: colors.success },
});
