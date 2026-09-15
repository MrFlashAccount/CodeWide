import { LegendList } from "@legendapp/list/react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { CatalogSkill } from "../../../data/skill-catalog-types";
import { colors } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { listRowHeight } from "../../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { InlineIcon } from "../../../ui/InlineIcon";
import { skillFilters, skillPickerRows, type SkillFilter } from "../../../ui/skill-picker-model";
import { SkillPickerRow } from "../../../ui/SkillPickerRow";
import { SkillPluginIcon } from "../../../ui/SkillPluginIcon";
import { AppTextInput, AppText as Text } from "../../../ui/Typography";
import { styles } from "./SkillsPicker.styles";
export function SkillsPicker({
  skills,
  loading,
  error,
  onSelect,
  getTransferAccess,
}: {
  skills: readonly CatalogSkill[];
  loading: boolean;
  error: string | null;
  getTransferAccess?: GetTransferAccess;
  onSelect(skill: CatalogSkill): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const rows = useMemo(() => skillPickerRows(skills, query, filter), [skills, query, filter]);
  const filterLabel = skillFilters.find(({ id }) => id === filter)?.label ?? "All sources";
  const unresolved = skills.some(
    (skill) => skill.enabled && skill.catalog?.pluginLink.status !== "resolved",
  );
  const emptyLabel =
    query.trim() !== ""
      ? "No matching skills"
      : filter !== "all"
        ? "No enabled skills from this source"
        : "No enabled skills for this workspace";
  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <InlineIcon name="search-outline" role="body" color={colors.textMuted} />
          <AppTextInput
            accessibilityLabel="Search skills"
            placeholder="Search skills"
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            voiceInput={false}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {query !== "" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear skill search"
              onPress={() => setQuery("")}
              style={styles.searchAction}
            >
              <InlineIcon name="close" role="body" color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <ActionMenu
          accessibilityLabel="Filter skills"
          actions={skillFilters
            .filter(
              ({ id }) =>
                id !== "unknown" ||
                skills.some((skill) => skill.enabled && skill.catalog?.source == null),
            )
            .map((item) => ({ ...item, selected: filter === item.id }))}
          onSelect={(id) => {
            const option = skillFilters.find((item) => item.id === id);
            if (option !== undefined) setFilter(option.id);
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Filter skills: ${filterLabel}`}
            style={styles.filter}
          >
            <InlineIcon
              name="options-outline"
              role="body"
              color={filter === "all" ? colors.textMuted : colors.accent}
            />
            {filter !== "all" && <View style={styles.filterDot} />}
          </Pressable>
        </ActionMenu>
      </View>
      {filter !== "all" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear skill source filter"
          onPress={() => setFilter("all")}
          style={styles.activeFilter}
        >
          <Text style={styles.filterLabel}>{filterLabel}</Text>
          <InlineIcon name="close" role="label" color={colors.textMuted} />
        </Pressable>
      )}
      {loading && <Text style={styles.notice}>Loading skills…</Text>}
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
      {!loading && error === null && unresolved && (
        <Text style={styles.notice}>Plugin details unavailable. Skills are still usable.</Text>
      )}
      <LegendList
        key={`${filter}:${query.trim()}`}
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        getFixedItemSize={(row) =>
          row.kind === "header" ? listRowHeight.single : listRowHeight.double
        }
        renderScrollComponent={AppSheetScrollView}
        recycleItems
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && error === null ? <Text style={styles.notice}>{emptyLabel}</Text> : null
        }
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <View accessibilityRole="header" style={styles.groupHeader}>
              <SkillPluginIcon
                key={item.plugin?.id ?? item.key}
                plugin={item.plugin}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              />
              <Text numberOfLines={2} style={styles.groupTitle}>
                {item.title}
              </Text>
              <Text style={styles.count}>{item.count}</Text>
            </View>
          ) : (
            <View style={[styles.row, item.first && styles.firstRow, item.last && styles.lastRow]}>
              <SkillPickerRow
                title={item.title}
                description={item.description}
                onPress={() => {
                  if (item.skill.enabled) onSelect(item.skill);
                }}
              />
              {!item.last && <View style={styles.separator} />}
            </View>
          )
        }
      />
    </View>
  );
}
