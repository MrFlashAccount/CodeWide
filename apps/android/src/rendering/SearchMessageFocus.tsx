import { createContext, useContext, useRef, type ReactNode } from "react";
import { Text, View } from "react-native";

import { colors } from "../theme";
import { EveryCommitProbe } from "../ui/CommitProbe";
import { occurrenceKey } from "./listKey";

interface MessageFocus {
  readonly itemId: string;
  readonly onLayout: (node: View) => void;
  readonly query: string;
}
export const SearchMessageFocus = createContext<MessageFocus | null>(null);
export const SearchHighlightQuery = createContext("");
interface MessageProps {
  readonly children: ReactNode;
  readonly itemId: unknown;
}

/** Scope by server-issued search record identity, not by equal message text. */
export function SearchMessage(props: MessageProps) {
  const focus = useContext(SearchMessageFocus);
  const ref = useRef<View>(null);
  const layout = () => {
    if (ref.current !== null) {
      focus?.onLayout(ref.current);
    }
  };
  if (focus === null || props.itemId !== focus.itemId) {
    return <>{props.children}</>;
  }
  return (
    <SearchHighlightQuery.Provider value={focus.query}>
      <View collapsable={false} onLayout={layout} ref={ref} testID="search-message-target">
        <EveryCommitProbe onCommit={layout} />
        {props.children}
      </View>
    </SearchHighlightQuery.Provider>
  );
}

interface HighlightProps {
  readonly text: string;
}
export function HighlightSearchText(props: HighlightProps) {
  const query = useContext(SearchHighlightQuery);
  if (query === "") {
    return props.text;
  }
  const tokens = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const occurrences = new Map<string, number>();
  return (
    <>
      {props.text.split(/(\s+)/u).map((part) => {
        const key = occurrenceKey(occurrences, part);
        return (
          <Text
            key={key}
            style={
              tokens.some((token) => part.toLocaleLowerCase().includes(token))
                ? { backgroundColor: colors.warningContainer, color: colors.text }
                : undefined
            }
          >
            {part}
          </Text>
        );
      })}
    </>
  );
}
