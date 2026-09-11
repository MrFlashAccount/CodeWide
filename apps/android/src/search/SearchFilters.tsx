import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { formatSearchDay } from "./search-calendar-date";
import { AppListRow } from "../ui/AppListRow";
import { listRowPosition } from "../ui/AppListRow.types";

export interface SearchServer { readonly id: string; readonly name: string }
export interface SearchThread { readonly id: string; readonly serverId: string; readonly title: string }
export interface SearchProject { readonly id: string; readonly serverId: string; readonly path: string; readonly name: string; readonly subtitle: string; readonly pinned: boolean }
export type SearchDateField = "from" | "until";
export interface SearchFilterValue {
  readonly serverId: string;
  readonly threadId: string;
  readonly project: string;
  readonly from: string;
  readonly until: string;
}
interface FiltersProps {
  readonly value: SearchFilterValue;
  readonly servers: readonly SearchServer[];
  readonly threads: readonly SearchThread[];
  readonly projects: readonly SearchProject[];
  readonly onPickDate: (field: SearchDateField) => void;
  readonly onChange: (value: SearchFilterValue) => void;
}

/** Editing filters is local; submitting search applies one complete filter set. */
export function SearchFilters(props: FiltersProps) {
  const value = props.value;
  const changeServer = (serverId: string) => props.onChange({ ...value, serverId, threadId: "", project: "" });
  const changeThread = (threadId: string) => props.onChange({ ...value, threadId });
  const changeProject = (id: string) => {
    if (id === "") { props.onChange({ ...value, project: "" }); return; }
    const project = props.projects.find(candidate => candidate.id === id);
    if (project !== undefined) props.onChange({ ...value, project: project.path, serverId: project.serverId, threadId: project.serverId === value.serverId ? value.threadId : "" });
  };
  const projects = props.projects.filter(project => value.serverId === "" || project.serverId === value.serverId).sort((left, right) => Number(right.pinned) - Number(left.pinned));
  const selectedProject = projects.find(project => project.path === value.project && project.serverId === value.serverId);
  return <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.panel}>
    <FilterSelect label="Server" value={value.serverId} onChange={changeServer}
      options={[{ id: "", label: "All servers" }, ...props.servers.map(server => ({ id: server.id, label: server.name.trim() || "Unnamed server" }))]} />
    <FilterSelect label="Chat" value={value.threadId} onChange={changeThread}
      options={[{ id: "", label: "All chats" }, ...props.threads.filter(thread => value.serverId === "" || thread.serverId === value.serverId).map(thread => ({ id: thread.id, label: thread.title.trim() || "Untitled chat" }))]} />
    <FilterSelect label="Project" value={selectedProject?.id ?? ""} onChange={changeProject}
      options={[{ id: "", label: "All projects" }, ...projects.map(project => ({ id: project.id, label: project.name, subtitle: project.subtitle, pinned: project.pinned }))]} />
    <View style={styles.divider} />
    <Text style={styles.heading}>Date range</Text>
    <View style={styles.group}>
      <Text style={styles.label}>From</Text>
      <DateField label="From date" value={value.from} onPress={() => props.onPickDate("from")} onClear={() => props.onChange({ ...value, from: "" })} />
    </View>
    <View style={styles.group}>
      <Text style={styles.label}>Through</Text>
      <DateField label="Through date" value={value.until} onPress={() => props.onPickDate("until")} onClear={() => props.onChange({ ...value, until: "" })} />
    </View>
    <Text style={styles.hint}>Leave dates empty to search all history. Changes apply when you search.</Text>
  </ScrollView>;
}

interface DateFieldProps { readonly label: string; readonly value: string; readonly onPress: () => void; readonly onClear: () => void }
function DateField(props: DateFieldProps) {
  return <View style={styles.dateRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress} style={styles.dateButton}>
      <Ionicons name="calendar-outline" size={iconSize.inline} color={colors.textMuted} />
      <Text style={styles.selected}>{props.value === "" ? "Any date" : formatSearchDay(props.value)}</Text>
    </Pressable>
    {props.value !== "" && <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${props.label.toLowerCase()}`} onPress={props.onClear} style={styles.clearDate}><Ionicons name="close" size={iconSize.inline} color={colors.textMuted} /></Pressable>}
  </View>;
}

interface FilterOption { readonly id: string; readonly label: string; readonly subtitle?: string; readonly pinned?: boolean }
interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly onChange: (id: string) => void;
}

function FilterSelect(props: SelectProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  const selected = props.options.find(option => option.id === props.value);
  return <View style={styles.group}>
    <Text style={styles.label}>{props.label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Search ${props.label.toLowerCase()}`} accessibilityState={{ expanded }} onPress={toggle} style={styles.select}>
      <Text numberOfLines={1} style={styles.selected}>{selected?.label ?? "Unavailable"}</Text>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={iconSize.inline} color={colors.textMuted} />
    </Pressable>
    {expanded && <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.options}>
      {props.options.map((option, index) => {
        const select = () => { props.onChange(option.id); setExpanded(false); };
        return <AppListRow key={option.id} title={option.label} {...(option.subtitle === undefined ? {} : { description: option.subtitle })}
          onPress={select} selected={props.value === option.id} position={listRowPosition(index, props.options.length)} multiline
          accessibilityLabel={option.pinned === true ? `${option.label}, pinned project` : option.label}
          {...(option.pinned === true ? { trailingIcon: { name: "pin-outline", size: iconSize.inline, color: colors.textMuted } } : {})} />;
      })}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  panel: { padding: spacing.lg, gap: spacing.md },
  heading: { ...typeScale.body, color: colors.text },
  group: { gap: spacing.xs },
  label: { ...typeScale.label, color: colors.textMuted },
  hint: { ...typeScale.label, color: colors.textDim },
  dateRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceRaised, borderRadius: radii.small },
  dateButton: { flex: 1, minHeight: controlSize.regular, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm },
  clearDate: { width: controlSize.regular, height: controlSize.regular, alignItems: "center", justifyContent: "center" },
  select: { minHeight: controlSize.regular, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radii.small },
  selected: { flex: 1, minWidth: 0, ...typeScale.body, color: colors.text },
  options: { maxHeight: controlSize.regular * 5, backgroundColor: colors.surfaceRaised, borderRadius: radii.small },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
});
