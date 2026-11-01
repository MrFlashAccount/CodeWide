import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactElement } from "react";
import { Pressable, View, type ScrollViewProps } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppList } from "../../ui/AppList";
import { AppListRow } from "../../ui/AppListRow";
import { SheetPageTransition, useSheetBackHandler } from "../../ui/sheetNavigation";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { CandidateRow } from "./CandidateRow";
import { ForwardingRow } from "./ForwardingRow";
import { ManualPortForm } from "./ManualPortForm";
import { usePortActions } from "./portActions";
import { usePortForm } from "./portForm";
import type {
  PortForwardingManagerProps,
  ServiceListRow,
  ServiceSegment,
} from "./portForwardingContract";
import {
  emptySegmentSubtitle,
  emptySegmentTitle,
  segmentTitle,
  serviceRowKey,
  serviceRowPosition,
} from "./portForwardingList";
import { styles } from "./PortForwardingManager.styles";
import { projectPortList } from "./portListProjection";
import { InfoRow, InlineError, SectionLabel, ServiceIcon } from "./PortPresentation";

type PortListProjection = ReturnType<typeof projectPortList>;

type PortForwardingManagerViewProps = PortForwardingManagerProps & {
  readonly scrollComponent?: (props: ScrollViewProps) => ReactElement | null;
};

type PortForwardingListProps = {
  readonly counts: PortListProjection["counts"];
  readonly groups: PortListProjection["groups"];
  readonly portActions: ReturnType<typeof usePortActions>;
  readonly portForm: ReturnType<typeof usePortForm>;
  readonly props: PortForwardingManagerViewProps;
  readonly query: string;
  readonly rows: PortListProjection["rows"];
  readonly segment: ServiceSegment;
  readonly setQuery: (query: string) => void;
  readonly setSegment: (segment: ServiceSegment) => void;
};

export function PortForwardingManager(props: PortForwardingManagerViewProps): React.JSX.Element {
  const portForm = usePortForm(props);
  const portActions = usePortActions(props);
  const [segment, setSegment] = useState<ServiceSegment>("active");
  const [query, setQuery] = useState("");
  useSheetBackHandler(portForm.form !== null, portForm.closeForm);
  const { counts, groups, rows } = projectPortList(props, segment, query);
  return (
    <SheetPageTransition
      direction={portForm.navigationDirection}
      routeKey={portForm.form === null ? "list" : "form"}
    >
      {portForm.form === null ? (
        <PortForwardingList
          counts={counts}
          groups={groups}
          portActions={portActions}
          portForm={portForm}
          props={props}
          query={query}
          rows={rows}
          segment={segment}
          setQuery={setQuery}
          setSegment={setSegment}
        />
      ) : (
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
      )}
    </SheetPageTransition>
  );
}

function PortForwardingList({
  counts,
  groups,
  portActions,
  portForm,
  props,
  query,
  rows,
  segment,
  setQuery,
  setSegment,
}: PortForwardingListProps): React.JSX.Element {
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

      <AppList
        contentContainerStyle={styles.listContent}
        data={rows}
        footer={
          segment === "available" && query === "" ? (
            <AppListRow
              description="Enter a localhost port manually"
              leading={<ServiceIcon name="keypad-outline" />}
              onPress={portForm.openManual}
              title="Port not listed"
            />
          ) : null
        }
        header={
          <PortListNotices
            actionError={portActions.actionError}
            groups={groups}
            props={props}
            query={query}
            segment={segment}
          />
        }
        keyExtractor={serviceRowKey}
        nestedScrollEnabled
        renderItem={({ index, item }) => (
          <PortListRow
            index={index}
            item={item}
            portActions={portActions}
            portForm={portForm}
            props={props}
            rows={rows}
          />
        )}
        {...(props.scrollComponent === undefined ? {} : { scrollComponent: props.scrollComponent })}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        virtualized
      />
    </View>
  );
}

function PortListNotices({
  actionError,
  groups,
  props,
  query,
  segment,
}: {
  readonly actionError: string | null;
  readonly groups: PortListProjection["groups"];
  readonly props: PortForwardingManagerProps;
  readonly query: string;
  readonly segment: ServiceSegment;
}): React.JSX.Element {
  return (
    <>
      {actionError !== null && <InlineError value={actionError} />}
      {loadingNotice(props)}
      {errorNotice(props)}
      {emptyNotice({ groupCount: groups.length, props, query, segment })}
    </>
  );
}

function loadingNotice(props: PortForwardingManagerProps): React.JSX.Element | null {
  return props.discoveryStatus === "loading" && props.discoveredPorts.length === 0 ? (
    <InfoRow
      icon="scan-outline"
      loading
      subtitle="Reading localhost listeners"
      title="Looking for open ports…"
    />
  ) : null;
}

function errorNotice(props: PortForwardingManagerProps): React.JSX.Element | null {
  return props.discoveryStatus === "error" ? (
    <InfoRow
      icon="alert-circle-outline"
      subtitle={props.discoveryError ?? "Waiting for automatic discovery"}
      title="Could not scan ports"
    />
  ) : null;
}

function emptyNotice({
  groupCount,
  props,
  query,
  segment,
}: {
  readonly groupCount: number;
  readonly props: PortForwardingManagerProps;
  readonly query: string;
  readonly segment: ServiceSegment;
}): React.JSX.Element | null {
  if (props.discoveryStatus !== "ready" || groupCount !== 0) {
    return null;
  }
  return (
    <InfoRow
      icon={segment === "excluded" ? "ban-outline" : "checkmark-circle-outline"}
      subtitle={query === "" ? emptySegmentSubtitle(segment) : "Try another name, category or port"}
      title={emptySegmentTitle(segment)}
    />
  );
}

function PortListRow({
  index,
  item,
  portActions,
  portForm,
  props,
  rows,
}: {
  readonly index: number;
  readonly item: ServiceListRow;
  readonly portActions: ReturnType<typeof usePortActions>;
  readonly portForm: ReturnType<typeof usePortForm>;
  readonly props: PortForwardingManagerProps;
  readonly rows: readonly ServiceListRow[];
}): React.JSX.Element {
  if (item.type === "group") {
    return (
      <View style={styles.groupCell}>
        <SectionLabel value={item.group} />
      </View>
    );
  }
  if (item.type === "candidate") {
    return (
      <CandidateRow
        candidate={item.candidate}
        onExclude={() => void portActions.excludePort(item.candidate)}
        onPress={() => void portActions.choosePort(item.candidate)}
        pending={portActions.pendingPort === item.candidate.port}
        position={serviceRowPosition(rows, index)}
      />
    );
  }
  return (
    <ForwardingRow
      kind={item.kind}
      onEdit={() => {
        portForm.openEdit(item.profile);
      }}
      onInclude={() => {
        portActions.activateProfileAction(item.profile.id, async () =>
          props.onSetPreference(item.profile.id, "included"),
        );
      }}
      onOpen={() => {
        if (item.profile.previewUrl !== null) {
          props.onOpenBrowser(item.profile.label, item.profile.previewUrl);
        }
      }}
      onReconnect={() => {
        portActions.activateProfileAction(item.profile.id, async () =>
          props.onReconnect(item.profile.id),
        );
      }}
      onRemove={() => {
        portActions.activateProfileAction(item.profile.id, async () =>
          props.onRemove(item.profile.id),
        );
      }}
      onStart={() => {
        portActions.activateProfileAction(item.profile.id, async () =>
          props.onStart(item.profile.id),
        );
      }}
      onStop={() => {
        portActions.activateProfileAction(item.profile.id, async () =>
          props.onStop(item.profile.id),
        );
      }}
      onToggleActions={() => {
        portActions.setActionMenuProfileId((current) =>
          current === item.profile.id ? null : item.profile.id,
        );
      }}
      pending={portActions.pendingId === item.profile.id}
      position={serviceRowPosition(rows, index)}
      profile={item.profile}
      webActionsVisible={portActions.actionMenuProfileId === item.profile.id}
    />
  );
}
