import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { NativeCodeBlock } from "../../rendering/NativeCodeBlock";
import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { pagedTextViewerStyles as styles } from "./pagedTextViewerStyles";

export interface PagedTextPage {
  content: string;
  format: "json" | "terminal" | "text";
  next: string | null;
  totalBytes: string;
}

export interface PagedTextViewerProps {
  contentName: string;
  copyText(value: string): Promise<void>;
  emptyLabel: string;
  initialPage: PagedTextPage;
  loadPage(cursor: string): Promise<PagedTextPage>;
  onClose(): void;
  title: string;
}

type ViewerState =
  | { kind: "ready"; pages: PagedTextPage[] }
  | { kind: "loading"; pages: PagedTextPage[] }
  | { kind: "failed"; message: string; pages: PagedTextPage[] };

/** Renders bounded pages and materializes the complete value only on explicit copy. */
export function PagedTextViewer(props: PagedTextViewerProps): React.JSX.Element {
  const { contentName, copyText, emptyLabel, initialPage, loadPage, onClose, title } = props;
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ViewerState>({ kind: "ready", pages: [initialPage] });
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = state.pages.map(pageContent).join("");
  const lastPage = state.pages.at(-1);
  const next = lastPage === undefined ? null : lastPage.next;
  const loadMore = useEvent(() => {
    if (state.kind === "loading" || next === null) return;
    setState({ kind: "loading", pages: state.pages });
    void loadPage(next)
      .then((page) => {
        validateContinuation(initialPage, page, next);
        setState({ kind: "ready", pages: [...state.pages, page] });
      })
      .catch(() => {
        setState({
          kind: "failed",
          message: `Could not load more ${contentName}. Try again.`,
          pages: state.pages,
        });
      });
  });
  const copyAll = useEvent(() => {
    if (copying) return;
    setCopying(true);
    setCopied(false);
    void copyCompleteText({ copyText, initialPage, loadPage, pages: state.pages })
      .then((pages) => {
        setState({ kind: "ready", pages });
        setCopied(true);
        setCopying(false);
      })
      .catch(() => {
        setState({
          kind: "failed",
          message: `Could not copy complete ${contentName}. Try again.`,
          pages: state.pages,
        });
        setCopying(false);
      });
  });
  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ProductText numberOfLines={1} style={styles.title} weight="semibold">
          {title}
        </ProductText>
        <Pressable
          accessibilityLabel={`Copy complete ${contentName}`}
          accessibilityRole="button"
          accessibilityState={{ busy: copying, disabled: copying }}
          disabled={copying}
          onPress={copyAll}
          style={styles.action}
        >
          <ProductText tone={copied ? "success" : "muted"} weight="semibold">
            {copying ? "Copying…" : copied ? "Copied" : "Copy"}
          </ProductText>
        </Pressable>
        <Pressable
          accessibilityLabel={`Close ${title.toLocaleLowerCase()}`}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.close}
        >
          <PresentationIcon color={colors.text} name="close" size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} testID="paged-text-scroll">
        {content === "" ? (
          <ProductText tone="muted">{emptyLabel}</ProductText>
        ) : (
          <NativeCodeBlock
            language={initialPage.format === "terminal" ? "text" : initialPage.format}
            maxHeight={10_008}
            truncate={false}
            value={content}
          />
        )}
        {state.kind === "failed" ? (
          <ProductText accessibilityLiveRegion="polite" tone="danger">
            {state.message}
          </ProductText>
        ) : null}
        {next === null ? null : (
          <Pressable
            accessibilityLabel={`Load more ${contentName}`}
            accessibilityRole="button"
            accessibilityState={{
              busy: state.kind === "loading",
              disabled: state.kind === "loading",
            }}
            disabled={state.kind === "loading"}
            onPress={loadMore}
            style={styles.loadMore}
          >
            {state.kind === "loading" ? (
              <ShimmerText text={`Loading ${contentName}…`} />
            ) : (
              <ProductText tone="muted" weight="semibold">
                Load more
              </ProductText>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function pageContent(page: PagedTextPage): string {
  return page.content;
}

interface CopyCompleteTextInput {
  copyText(value: string): Promise<void>;
  initialPage: PagedTextPage;
  loadPage(cursor: string): Promise<PagedTextPage>;
  pages: PagedTextPage[];
}

async function copyCompleteText(input: CopyCompleteTextInput): Promise<PagedTextPage[]> {
  const pages = [...input.pages];
  const lastPage = pages.at(-1);
  let cursor = lastPage === undefined ? null : lastPage.next;
  while (cursor !== null) {
    const page = await input.loadPage(cursor);
    validateContinuation(input.initialPage, page, cursor);
    pages.push(page);
    cursor = page.next;
  }
  await input.copyText(pages.map(pageContent).join(""));
  return pages;
}

function validateContinuation(
  initialPage: PagedTextPage,
  page: PagedTextPage,
  cursor: string,
): void {
  if (page.next === cursor) throw new Error("Paged text returned a repeated cursor");
  if (page.format !== initialPage.format || page.totalBytes !== initialPage.totalBytes)
    throw new Error("Paged text changed while it was being read");
}
