import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { colors, controlSize, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { CandidateRow } from "./CandidateRow";
import { ForwardingRow } from "./ForwardingRow";
import { ManualPortForm } from "./ManualPortForm";
import { usePortActions } from "./portActions";
import { usePortForm } from "./portForm";
import type { PortForwardingManagerProps, ServiceSegment } from "./portForwardingContract";
import {
  emptySegmentSubtitle,
  emptySegmentTitle,
  GROUP_HEIGHT,
  hasProfileError,
  PROFILE_ERROR_HEIGHT,
  segmentTitle,
  serviceRowKey,
  serviceRowPosition,
} from "./portForwardingList";
import { styles } from "./PortForwardingManager.styles";
import { projectPortList } from "./portListProjection";
import { InfoRow, InlineError, SectionLabel, ServiceIcon } from "./PortPresentation";

export function PortForwardingManager(props: PortForwardingManagerProps) {
  const portForm = usePortForm(props);
  const portActions = usePortActions(props);
  const [segment, setSegment] = useState<ServiceSegment>("active");
  const [query, setQuery] = useState("");
  if (portForm.form !== null) {
    return (
      <ManualPortForm
        error={portForm.formError}
        form={portForm.form}
        onBack={portForm.closeForm}
        onChange={portForm.setForm}
        onSubmit={() => void portForm.submit()}
        serverName={props.serverName}
        submitting={portForm.submitting}
        {...(portForm.form.id === null ? {} : { onRemove: () => void portForm.removeCurrent() })}
      />
    );
  }

  const { counts, groups, rows } = projectPortList(props, segment, query);
  return (
    <View style={styles.root} testID="port-forwarding-manager">
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Ports</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {props.serverName}
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        <View accessibilityRole="tablist" style={styles.segments}>
          {(["active", "available", "excluded"] as const).map((value) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === value }}
              key={value}
              onPress={() => {
                setSegment(value);
              }}
              style={[styles.segment, segment === value && styles.segmentSelected]}
            >
              <Text
                style={[styles.segmentText, segment === value && styles.segmentTextSelected]}
              >{`${segmentTitle(value)} ${String(counts[value])}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.searchField}>
          <Ionicons color={colors.textDim} name="search" size={iconSize.inline} />
          <TextInput
            accessibilityLabel="Filter ports"
            onChangeText={setQuery}
            placeholder="Name, category or port"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
            value={query}
          />
          {query !== "" && (
            <Pressable
              accessibilityLabel="Clear port filter"
              onPress={() => {
                setQuery("");
              }}
            >
              <Ionicons color={colors.textDim} name="close-circle" size={iconSize.inline} />
            </Pressable>
          )}
        </View>
      </View>

      <LegendList
        contentContainerStyle={styles.listContent}
        data={rows}
        drawDistance={360}
        getFixedItemSize={(entry) =>
          entry.type === "group"
            ? GROUP_HEIGHT
            : listRowHeight.double +
              (entry.type === "profile" && hasProfileError(entry.profile)
                ? PROFILE_ERROR_HEIGHT
                : 0) +
              (entry.type === "profile" &&
              Platform.OS === "web" &&
              portActions.webMenuId === entry.profile.id
                ? controlSize.regular
                : 0)
        }
        keyExtractor={serviceRowKey}
        nestedScrollEnabled
        recycleItems
        showsVerticalScrollIndicator={false}
        style={styles.list}
        {...(props.renderScrollComponent === undefined
          ? {}
          : { renderScrollComponent: props.renderScrollComponent })}
        ListFooterComponent={
          segment === "available" && query === "" ? (
            <AppListRow
              description="Enter a localhost port manually"
              leading={<ServiceIcon name="keypad-outline" />}
              onPress={portForm.openManual}
              title="Port not listed"
            />
          ) : null
        }
        ListHeaderComponent={
          <>
            {portActions.actionError !== null && <InlineError value={portActions.actionError} />}
            {props.discoveryStatus === "loading" && props.discoveredPorts.length === 0 && (
              <InfoRow
                icon="scan-outline"
                loading
                subtitle="Reading localhost listeners"
                title="Looking for open ports…"
              />
            )}
            {props.discoveryStatus === "error" && (
              <InfoRow
                icon="alert-circle-outline"
                subtitle={props.discoveryError ?? "Waiting for automatic discovery"}
                title="Could not scan ports"
              />
            )}
            {props.discoveryStatus === "ready" && groups.length === 0 && (
              <InfoRow
                icon={segment === "excluded" ? "ban-outline" : "checkmark-circle-outline"}
                subtitle={
                  query === ""
                    ? emptySegmentSubtitle(segment)
                    : "Try another name, category or port"
                }
                title={emptySegmentTitle(segment)}
              />
            )}
          </>
        }
        renderItem={({ index, item: entry }) =>
          entry.type === "group" ? (
            <View style={styles.groupCell}>
              <SectionLabel value={entry.group} />
            </View>
          ) : entry.type === "candidate" ? (
            <CandidateRow
              candidate={entry.candidate}
              key={entry.candidate.forwardingKey}
              onExclude={() => void portActions.excludePort(entry.candidate)}
              onPress={() => void portActions.choosePort(entry.candidate)}
              pending={portActions.pendingPort === entry.candidate.port}
              position={serviceRowPosition(rows, index)}
            />
          ) : (
            <ForwardingRow
              key={entry.profile.id}
              kind={entry.kind}
              onEdit={() => {
                portForm.openEdit(entry.profile);
              }}
              onInclude={() =>
                void portActions.runProfileAction(entry.profile.id, async () =>
                  props.onSetPreference(entry.profile.id, "included"),
                )
              }
              onOpen={() => {
                props.onOpen(entry.profile);
              }}
              onReconnect={() =>
                void portActions.runProfileAction(entry.profile.id, async () =>
                  props.onReconnect(entry.profile.id),
                )
              }
              onRemove={() =>
                void portActions.runProfileAction(entry.profile.id, async () =>
                  props.onRemove(entry.profile.id),
                )
              }
              onStart={() =>
                void portActions.runProfileAction(entry.profile.id, async () =>
                  props.onStart(entry.profile.id),
                )
              }
              onStop={() =>
                void portActions.runProfileAction(entry.profile.id, async () =>
                  props.onStop(entry.profile.id),
                )
              }
              onToggleWebMenu={() => {
                portActions.setWebMenuId((current) =>
                  current === entry.profile.id ? null : entry.profile.id,
                );
              }}
              pending={portActions.pendingId === entry.profile.id}
              position={serviceRowPosition(rows, index)}
              profile={entry.profile}
              webMenuVisible={portActions.webMenuId === entry.profile.id}
            />
          )
        }
      />
    </View>
  );
}
