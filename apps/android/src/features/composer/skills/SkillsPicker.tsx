import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
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
  error,
  getTransferAccess,
  loading,
  onSelect,
  skills,
}: {
  error: string | null;
  getTransferAccess?: GetTransferAccess;
  loading: boolean;
  onSelect: (skill: CatalogSkill) => void;
  skills: readonly CatalogSkill[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const rows = skillPickerRows(skills, query, filter);
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
          <InlineIcon color={colors.textMuted} name="search-outline" role="body" />
          <AppTextInput
            accessibilityLabel="Search skills"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search skills"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={query}
            voiceInput={false}
          />
          {query !== "" && (
            <Pressable
              accessibilityLabel="Clear skill search"
              accessibilityRole="button"
              onPress={() => {
                setQuery("");
              }}
              style={styles.searchAction}
            >
              <InlineIcon color={colors.textMuted} name="close" role="body" />
            </Pressable>
          )}
        </View>
        <ActionMenu
          accessibilityLabel="Filter skills"
          actions={skillFilters
            .filter(
              ({ id }) =>
                id !== "unknown" ||
                skills.some(
                  (skill) =>
                    (skill.enabled && skill.catalog?.source === null) ||
                    skill.catalog?.source === undefined,
                ),
            )
            .map((item) => ({ ...item, selected: filter === item.id }))}
          onSelect={(id) => {
            const option = skillFilters.find((item) => item.id === id);
            if (option !== undefined) {
              setFilter(option.id);
            }
          }}
        >
          <Pressable
            accessibilityLabel={`Filter skills: ${filterLabel}`}
            accessibilityRole="button"
            style={styles.filter}
          >
            <InlineIcon
              color={filter === "all" ? colors.textMuted : colors.accent}
              name="options-outline"
              role="body"
            />
            {filter !== "all" && <View style={styles.filterDot} />}
          </Pressable>
        </ActionMenu>
      </View>
      {filter !== "all" && (
        <Pressable
          accessibilityLabel="Clear skill source filter"
          accessibilityRole="button"
          onPress={() => {
            setFilter("all");
          }}
          style={styles.activeFilter}
        >
          <Text style={styles.filterLabel}>{filterLabel}</Text>
          <InlineIcon color={colors.textMuted} name="close" role="label" />
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
        contentContainerStyle={styles.content}
        data={rows}
        getFixedItemSize={(row) =>
          row.kind === "header" ? listRowHeight.single : listRowHeight.double
        }
        getItemType={(row) => row.kind}
        key={`${filter}:${query.trim()}`}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.key}
        ListEmptyComponent={
          !loading && error === null ? <Text style={styles.notice}>{emptyLabel}</Text> : null
        }
        recycleItems
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
                description={item.description}
                onPress={() => {
                  if (item.skill.enabled) {
                    onSelect(item.skill);
                  }
                }}
                title={item.title}
              />
              {!item.last && <View style={styles.separator} />}
            </View>
          )
        }
        renderScrollComponent={AppSheetScrollView}
        style={styles.list}
      />
    </View>
  );
}
