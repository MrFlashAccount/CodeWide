import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState, type ReactElement, type RefObject } from "react";
import { Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { styles as viewerStyles } from "../content/FullContentViewer.styles";
import { styles } from "./CommandOutputScreen.styles";
import { CopyButton } from "./MessageActionRail";
import { TaskOutputTerminal } from "./TaskOutputTerminal";
import type { TaskOutputTerminalHandle, TaskOutputTerminalProps } from "./TaskOutputTerminal.types";

/** Where a command stands, whether it ran in the foreground or as a background task. */
export type CommandOutputStatus =
  | "declined"
  | "failed"
  | "finished"
  | "lost"
  | "running"
  | "stopped"
  | "unknown";

/** The prompt glyph before the command, on screen and in the whole copy. */
const PROMPT = "❯";

/** Terminal states whose command row needs the one semantic failure accent. */
const FAILED_STATUS: ReadonlySet<CommandOutputStatus> = new Set(["declined", "failed", "lost"]);

const STATUS_LABEL: Record<CommandOutputStatus, string> = {
  declined: "Declined",
  failed: "Failed",
  finished: "Finished",
  lost: "Lost on restart",
  running: "Running",
  stopped: "Stopped",
  unknown: "Status unknown",
};

const STATUS_DOT: Record<CommandOutputStatus, string> = {
  declined: colors.red,
  failed: colors.red,
  finished: colors.green,
  lost: colors.red,
  running: colors.textMuted,
  stopped: colors.red,
  unknown: colors.textMuted,
};

/**
 * Every command an agent ran in a shell, on one screen: a header with a short
 * title, whole-output copy and native search, the complete command as a pinned
 * wrapping prompt line, and its output in a read-only terminal. Owners differ
 * only in where the output comes from.
 */
export function CommandOutputScreen({
  command,
  details,
  error,
  loading,
  onClose,
  output,
  outputSource,
  status,
  title,
}: {
  /** The command as launched; null when the Companion does not know it. */
  readonly command: string | null;
  /** Exit code, size and similar facts after the status word. */
  readonly details?: readonly string[];
  readonly error: string | null;
  /** True while the output is still being read for the first time. */
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly output: TaskOutputTerminalProps["output"];
  /**
   * Names where the output text comes from. The terminal appends what it has
   * not seen, so a text that replaces rather than extends the previous one
   * must come with a new source.
   */
  readonly outputSource: string;
  readonly status: CommandOutputStatus;
  readonly title: string;
}): ReactElement {
  const terminal = useRef<TaskOutputTerminalHandle>(null);
  const searchInput = useRef<NativeTextInput>(null);
  const searchQuery = useRef("");
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useEvent(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
    });
  });
  const closeSearch = useEvent(() => {
    searchQuery.current = "";
    searchInput.current?.clear();
    terminal.current?.clearSearch().catch(() => undefined);
    setSearchOpen(false);
  });
  const updateSearch = useEvent((query: string) => {
    searchQuery.current = query;
  });
  const findNext = useEvent(() => {
    if (searchQuery.current !== "") {
      terminal.current?.findNext(searchQuery.current).catch(() => false);
    }
  });
  const findPrevious = useEvent(() => {
    if (searchQuery.current !== "") {
      terminal.current?.findPrevious(searchQuery.current).catch(() => false);
    }
  });
  const plain = stripTerminalControlSequences(output.text);
  // The whole copy reads like the terminal: the prompt line, then the output.
  const whole = command === null ? plain : `${PROMPT} ${command}\n${plain}`;
  return (
    <View style={viewerStyles.fullContentViewer} testID="command-output-screen">
      <CommandOutputHeader
        findNext={findNext}
        findPrevious={findPrevious}
        onClose={onClose}
        onCloseSearch={closeSearch}
        onOpenSearch={openSearch}
        onSearchChange={updateSearch}
        searchInput={searchInput}
        searchOpen={searchOpen}
        title={title}
        whole={whole}
      />
      <View style={viewerStyles.fullContentViewport}>
        {command === null ? null : (
          <CommandPromptLine
            command={command}
            error={error}
            failed={FAILED_STATUS.has(status)}
            running={status === "running"}
          />
        )}
        {loading ? (
          <WaveText
            containerStyle={styles.loading}
            style={viewerStyles.menuNotice}
            text="Loading output…"
          />
        ) : (
          <TaskOutputTerminal key={outputSource} output={output} ref={terminal} />
        )}
      </View>
      {details === undefined ? null : <CommandOutputFooter details={details} status={status} />}
    </View>
  );
}

/** Close, the title and copying the command with its output. */
function CommandOutputHeader({
  findNext,
  findPrevious,
  onClose,
  onCloseSearch,
  onOpenSearch,
  onSearchChange,
  searchInput,
  searchOpen,
  title,
  whole,
}: {
  readonly findNext: () => void;
  readonly findPrevious: () => void;
  readonly onClose: () => void;
  readonly onCloseSearch: () => void;
  readonly onOpenSearch: () => void;
  readonly onSearchChange: (query: string) => void;
  readonly searchInput: RefObject<NativeTextInput | null>;
  readonly searchOpen: boolean;
  readonly title: string;
  readonly whole: string;
}): ReactElement {
  return (
    <View style={viewerStyles.fullContentHeader} testID="command-output-header">
      <Pressable
        accessibilityLabel="Close command output"
        accessibilityRole="button"
        onPress={onClose}
        style={viewerStyles.headerIcon}
      >
        <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
      </Pressable>
      {searchOpen ? (
        <CommandOutputSearch
          findNext={findNext}
          findPrevious={findPrevious}
          input={searchInput}
          onChange={onSearchChange}
          onClose={onCloseSearch}
        />
      ) : (
        <CommandOutputTitle onOpenSearch={onOpenSearch} title={title} whole={whole} />
      )}
    </View>
  );
}

/** Stable non-search app-bar content. */
function CommandOutputTitle({
  onOpenSearch,
  title,
  whole,
}: {
  readonly onOpenSearch: () => void;
  readonly title: string;
  readonly whole: string;
}): ReactElement {
  return (
    <>
      <View style={viewerStyles.fullContentHeaderIcon}>
        <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.inline} />
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Pressable
        accessibilityLabel="Search command output"
        accessibilityRole="button"
        hitSlop={controlHitSlop.regular}
        onPress={onOpenSearch}
        style={viewerStyles.headerIcon}
      >
        <Ionicons color={colors.text} name="search-outline" size={iconSize.navigation} />
      </Pressable>
      {whole === "" ? null : <CopyButton text={whole} />}
    </>
  );
}

/** Search controls stay in the app bar while Ghostty owns matching and selection. */
function CommandOutputSearch({
  findNext,
  findPrevious,
  input,
  onChange,
  onClose,
}: {
  readonly findNext: () => void;
  readonly findPrevious: () => void;
  readonly input: RefObject<NativeTextInput | null>;
  readonly onChange: (query: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <View style={styles.search}>
      <Ionicons color={colors.textMuted} name="search" size={iconSize.inline} />
      <TextInput
        accessibilityLabel="Find in command output"
        accessibilityRole="search"
        compact
        onChangeText={onChange}
        onSubmitEditing={findNext}
        placeholder="Find in output"
        placeholderTextColor={colors.textDim}
        ref={input}
        returnKeyType="search"
        style={styles.searchInput}
        voiceInput={false}
      />
      <SearchAction accessibilityLabel="Previous match" icon="chevron-up" onPress={findPrevious} />
      <SearchAction accessibilityLabel="Next match" icon="chevron-down" onPress={findNext} />
      <SearchAction accessibilityLabel="Close output search" icon="close" onPress={onClose} />
    </View>
  );
}

/** One compact app-bar action in the output search controls. */
function SearchAction({
  accessibilityLabel,
  icon,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly icon: "chevron-down" | "chevron-up" | "close";
  readonly onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={controlHitSlop.regular}
      onPress={onPress}
      style={styles.searchAction}
    >
      <Ionicons color={colors.text} name={icon} size={iconSize.action} />
    </Pressable>
  );
}

/**
 * The complete command as a prompt line on the terminal's surface, wrapped
 * rather than cut, pinned while the output scrolls under it, with its own copy.
 */
function CommandPromptLine({
  command,
  error,
  failed,
  running,
}: {
  readonly command: string;
  readonly error: string | null;
  readonly failed: boolean;
  readonly running: boolean;
}): ReactElement {
  const showsFailure = failed || error !== null;
  return (
    <View style={styles.command} testID="command-output-command">
      <Text style={styles.commandPrompt}>{PROMPT}</Text>
      <Text selectable={!running} shimmering={running} style={styles.commandText}>
        {command}
      </Text>
      {showsFailure ? (
        <View
          accessibilityLabel={error ?? "Command failed"}
          accessibilityRole="alert"
          style={styles.commandError}
          testID="command-output-error"
        >
          <Ionicons color={colors.red} name="alert-circle" size={iconSize.action} />
        </View>
      ) : null}
      <CopyButton compact text={command} />
    </View>
  );
}

/** The stable command result remains visible below the scrolling terminal. */
function CommandOutputFooter({
  details,
  status,
}: {
  readonly details: readonly string[];
  readonly status: CommandOutputStatus;
}): ReactElement {
  return (
    <View style={viewerStyles.fullContentFooter}>
      <View style={[styles.dot, { backgroundColor: STATUS_DOT[status] }]} />
      <Text shimmering={status === "running"} style={styles.status}>
        {STATUS_LABEL[status]}
      </Text>
      {details.length === 0 ? null : (
        <Text numberOfLines={1} style={styles.details}>
          · {details.join(" · ")}
        </Text>
      )}
    </View>
  );
}
