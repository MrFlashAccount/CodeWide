import { createContext, useContext, useRef, type ReactNode } from "react";
import { Text, View } from "react-native";

import { colors } from "../theme";
import { EveryCommitProbe } from "../ui/CommitProbe";

interface MessageFocus {
  readonly itemId: string;
  readonly query: string;
  readonly onLayout: (node: View) => void;
}
export const SearchMessageFocus = createContext<MessageFocus | null>(null);
export const SearchHighlightQuery = createContext("");
interface MessageProps {
  readonly itemId: unknown;
  readonly children: ReactNode;
}

/** Scope by server-issued search record identity, not by equal message text. */
export function SearchMessage(props: MessageProps) {
  const focus = useContext(SearchMessageFocus);
  const ref = useRef<View>(null);
  const layout = () => {
    if (ref.current !== null) focus?.onLayout(ref.current);
  };
  if (focus === null || props.itemId !== focus.itemId) return <>{props.children}</>;
  return (
    <SearchHighlightQuery.Provider value={focus.query}>
      <View ref={ref} collapsable={false} onLayout={layout} testID="search-message-target">
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
  if (query === "") return props.text;
  const tokens = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return (
    <>
      {props.text.split(/(\s+)/u).map((part, index) => (
        <Text
          key={index}
          style={
            tokens.some((token) => part.toLocaleLowerCase().includes(token))
              ? { backgroundColor: colors.warningContainer, color: colors.text }
              : undefined
          }
        >
          {part}
        </Text>
      ))}
    </>
  );
}
