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
import { type PortForwardingManagerProps, type ServiceSegment } from "./portForwardingContract";
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
  if (portForm.form !== null)
    return (
      <ManualPortForm
        serverName={props.serverName}
        form={portForm.form}
        submitting={portForm.submitting}
        error={portForm.formError}
        onChange={portForm.setForm}
        onBack={portForm.closeForm}
        onSubmit={() => void portForm.submit()}
        {...(portForm.form.id === null ? {} : { onRemove: () => void portForm.removeCurrent() })}
      />
    );

  const { rows, counts, groups } = projectPortList(props, segment, query);
  return (
    <View testID="port-forwarding-manager" style={styles.root}>
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
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === value }}
              onPress={() => setSegment(value)}
              style={[styles.segment, segment === value && styles.segmentSelected]}
            >
              <Text
                style={[styles.segmentText, segment === value && styles.segmentTextSelected]}
              >{`${segmentTitle(value)} ${counts[value]}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.searchField}>
          <Ionicons name="search" size={iconSize.inline} color={colors.textDim} />
          <TextInput
            accessibilityLabel="Filter ports"
            value={query}
            onChangeText={setQuery}
            placeholder="Name, category or port"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
          />
          {query !== "" && (
            <Pressable accessibilityLabel="Clear port filter" onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={iconSize.inline} color={colors.textDim} />
            </Pressable>
          )}
        </View>
      </View>

      <LegendList
        style={styles.list}
        data={rows}
        drawDistance={360}
        keyExtractor={serviceRowKey}
        recycleItems
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
        nestedScrollEnabled
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        {...(props.renderScrollComponent === undefined
          ? {}
          : { renderScrollComponent: props.renderScrollComponent })}
        ListHeaderComponent={
          <>
            {portActions.actionError !== null && <InlineError value={portActions.actionError} />}
            {props.discoveryStatus === "loading" && props.discoveredPorts.length === 0 && (
              <InfoRow
                icon="scan-outline"
                title="Looking for open ports…"
                subtitle="Reading localhost listeners"
                loading
              />
            )}
            {props.discoveryStatus === "error" && (
              <InfoRow
                icon="alert-circle-outline"
                title="Could not scan ports"
                subtitle={props.discoveryError ?? "Waiting for automatic discovery"}
              />
            )}
            {props.discoveryStatus === "ready" && groups.length === 0 && (
              <InfoRow
                icon={segment === "excluded" ? "ban-outline" : "checkmark-circle-outline"}
                title={emptySegmentTitle(segment)}
                subtitle={
                  query === ""
                    ? emptySegmentSubtitle(segment)
                    : "Try another name, category or port"
                }
              />
            )}
          </>
        }
        renderItem={({ item: entry, index }) =>
          entry.type === "group" ? (
            <View style={styles.groupCell}>
              <SectionLabel value={entry.group} />
            </View>
          ) : entry.type === "candidate" ? (
            <CandidateRow
              key={entry.candidate.forwardingKey}
              candidate={entry.candidate}
              position={serviceRowPosition(rows, index)}
              pending={portActions.pendingPort === entry.candidate.port}
              onPress={() => void portActions.choosePort(entry.candidate)}
              onExclude={() => void portActions.excludePort(entry.candidate)}
            />
          ) : (
            <ForwardingRow
              key={entry.profile.id}
              position={serviceRowPosition(rows, index)}
              profile={entry.profile}
              kind={entry.kind}
              pending={portActions.pendingId === entry.profile.id}
              webMenuVisible={portActions.webMenuId === entry.profile.id}
              onToggleWebMenu={() =>
                portActions.setWebMenuId((current) =>
                  current === entry.profile.id ? null : entry.profile.id,
                )
              }
              onEdit={() => portForm.openEdit(entry.profile)}
              onOpen={() => props.onOpen(entry.profile)}
              onStart={() =>
                void portActions.runProfileAction(entry.profile.id, () =>
                  props.onStart(entry.profile.id),
                )
              }
              onStop={() =>
                void portActions.runProfileAction(entry.profile.id, () =>
                  props.onStop(entry.profile.id),
                )
              }
              onReconnect={() =>
                void portActions.runProfileAction(entry.profile.id, () =>
                  props.onReconnect(entry.profile.id),
                )
              }
              onRemove={() =>
                void portActions.runProfileAction(entry.profile.id, () =>
                  props.onRemove(entry.profile.id),
                )
              }
              onInclude={() =>
                void portActions.runProfileAction(entry.profile.id, () =>
                  props.onSetPreference(entry.profile.id, "included"),
                )
              }
            />
          )
        }
        ListFooterComponent={
          segment === "available" && query === "" ? (
            <AppListRow
              title="Port not listed"
              description="Enter a localhost port manually"
              onPress={portForm.openManual}
              leading={<ServiceIcon name="keypad-outline" />}
            />
          ) : null
        }
      />
    </View>
  );
}
