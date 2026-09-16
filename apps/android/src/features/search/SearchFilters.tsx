import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";
import { FilterSelect } from "./FilterSelect";
import { styles } from "./SearchFilters.styles";

import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { formatSearchDay } from "./search-calendar-date";

export interface SearchServer {
  readonly id: string;
  readonly name: string;
}
export interface SearchThread {
  readonly id: string;
  readonly serverId: string;
  readonly title: string;
}
export interface SearchProject {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly pinned: boolean;
  readonly serverId: string;
  readonly subtitle: string;
}
export type SearchDateField = "from" | "until";
export interface SearchFilterValue {
  readonly from: string;
  readonly project: string;
  readonly serverId: string;
  readonly threadId: string;
  readonly until: string;
}
interface FiltersProps {
  readonly onChange: (value: SearchFilterValue) => void;
  readonly onPickDate: (field: SearchDateField) => void;
  readonly projects: readonly SearchProject[];
  readonly servers: readonly SearchServer[];
  readonly threads: readonly SearchThread[];
  readonly value: SearchFilterValue;
}

/** Editing filters is local; submitting search applies one complete filter set. */
export function SearchFilters(props: FiltersProps) {
  const value = props.value;
  const changeServer = (serverId: string) => {
    props.onChange({ ...value, project: "", serverId, threadId: "" });
  };
  const changeThread = (threadId: string) => {
    props.onChange({ ...value, threadId });
  };
  const changeProject = (id: string) => {
    if (id === "") {
      props.onChange({ ...value, project: "" });
      return;
    }
    const project = props.projects.find((candidate) => candidate.id === id);
    if (project !== undefined) {
      props.onChange({
        ...value,
        project: project.path,
        serverId: project.serverId,
        threadId: project.serverId === value.serverId ? value.threadId : "",
      });
    }
  };
  const projects = props.projects
    .filter((project) => value.serverId === "" || project.serverId === value.serverId)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned));
  const selectedProject = projects.find(
    (project) => project.path === value.project && project.serverId === value.serverId,
  );
  return (
    <ScrollView
      contentContainerStyle={styles.panel}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
    >
      <FilterSelect
        label="Server"
        onChange={changeServer}
        options={[
          { id: "", label: "All servers" },
          ...props.servers.map((server) => ({
            id: server.id,
            label: server.name.trim() === "" ? "Unnamed server" : server.name.trim(),
          })),
        ]}
        value={value.serverId}
      />
      <FilterSelect
        label="Chat"
        onChange={changeThread}
        options={[
          { id: "", label: "All chats" },
          ...props.threads
            .filter((thread) => value.serverId === "" || thread.serverId === value.serverId)
            .map((thread) => ({
              id: thread.id,
              label: thread.title.trim() === "" ? "Untitled chat" : thread.title.trim(),
            })),
        ]}
        value={value.threadId}
      />
      <FilterSelect
        label="Project"
        onChange={changeProject}
        options={[
          { id: "", label: "All projects" },
          ...projects.map((project) => ({
            id: project.id,
            label: project.name,
            pinned: project.pinned,
            subtitle: project.subtitle,
          })),
        ]}
        value={selectedProject?.id ?? ""}
      />
      <View style={styles.divider} />
      <Text style={styles.heading}>Date range</Text>
      <View style={styles.group}>
        <Text style={styles.label}>From</Text>
        <DateField
          label="From date"
          onClear={() => {
            props.onChange({ ...value, from: "" });
          }}
          onPress={() => {
            props.onPickDate("from");
          }}
          value={value.from}
        />
      </View>
      <View style={styles.group}>
        <Text style={styles.label}>Through</Text>
        <DateField
          label="Through date"
          onClear={() => {
            props.onChange({ ...value, until: "" });
          }}
          onPress={() => {
            props.onPickDate("until");
          }}
          value={value.until}
        />
      </View>
      <Text style={styles.hint}>
        Leave dates empty to search all history. Changes apply when you search.
      </Text>
    </ScrollView>
  );
}

interface DateFieldProps {
  readonly label: string;
  readonly onClear: () => void;
  readonly onPress: () => void;
  readonly value: string;
}
function DateField(props: DateFieldProps) {
  return (
    <View style={styles.dateRow}>
      <Pressable
        accessibilityLabel={props.label}
        accessibilityRole="button"
        onPress={props.onPress}
        style={styles.dateButton}
      >
        <Ionicons color={colors.textMuted} name="calendar-outline" size={iconSize.inline} />
        <Text style={styles.selected}>
          {props.value === "" ? "Any date" : formatSearchDay(props.value)}
        </Text>
      </Pressable>
      {props.value !== "" && (
        <Pressable
          accessibilityLabel={`Clear ${props.label.toLowerCase()}`}
          accessibilityRole="button"
          onPress={props.onClear}
          style={styles.clearDate}
        >
          <Ionicons color={colors.textMuted} name="close" size={iconSize.inline} />
        </Pressable>
      )}
    </View>
  );
}
