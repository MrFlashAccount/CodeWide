import React from "react";
import { requireNativeComponent, StyleSheet, View } from "react-native";
import { useRecyclingState } from "@legendapp/list/react-native";
import { useEvent } from "../../src/react/useEvent";

const HostedView = requireNativeComponent("CodeWideLabHostedTranscript");
const KeyedRow = React.createContext(false);

// Each hosted row has its semantic React key for its entire lifetime. Stock rows retain
// LegendList's recycling state. A visible row never moves between these two providers.
export function useLabRowState(initial) {
  const useRowState = React.useContext(KeyedRow) ? React.useState : useRecyclingState;
  return useRowState(initial);
}

export function hostedTimeline(standard, props) {
  const list = React.Children.only(standard.props.children);
  // Unsupported entry semantics stay with their owning viewport in the lab, too.
  if (
    list.props.initialScrollIndex !== undefined ||
    list.props.anchoredEndSpace ||
    props.threadSearchActive ||
    props.inlineQueueExpanded ||
    !props.historyViewport.containsLatest
  )
    return standard;
  return (
    <HostedAttempt
      key={props.composerScope}
      standard={standard}
      list={list.props}
      ready={props.commitInitialTimelineLoad}
    />
  );
}

// An unmatched native layout must never strand a real conversation behind the positioning skeleton.
// The diagnostic marker distinguishes a stock recovery from a successful native first frame.
function HostedAttempt({ standard, list, ready }) {
  const [fallback, setFallback] = React.useState(false);
  const accepted = React.useRef(false);
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      if (!accepted.current) setFallback(true);
    }, 1000);
    return () => clearTimeout(timeout);
  }, []);
  const reveal = useEvent(() => {
    if (fallback) return;
    accepted.current = true;
    ready();
  });
  if (fallback)
    return (
      <View testID="lab-stock-recovery" style={styles.fill}>
        {standard}
      </View>
    );
  return React.cloneElement(standard, undefined, <HostedRows list={list} ready={reveal} />);
}

const footerKey = "hosted:footer";
function HostedRows({ list, ready }) {
  const { data, renderItem, keyExtractor } = list;
  const keys = data
    .map((item, index) => "hosted:row:" + keyExtractor(item, index))
    .concat(footerKey);
  const [range, setRange] = React.useState(null);
  const onHostedRange = useEvent(({ nativeEvent: { first, last } }) =>
    setRange((previous) =>
      previous?.first === first && previous.last === last ? previous : { first, last },
    ),
  );
  const onHostedReady = useEvent(ready);
  const content = StyleSheet.flatten(list.contentContainerStyle);
  const horizontal = content.paddingHorizontal ?? 0;
  // The native holder supplies the horizontal inset. Yoga calculates each child with that same width.
  const wrapper = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    paddingRight: horizontal * 2,
  };
  const first = range?.first ?? Math.max(0, keys.length - 8);
  const last = Math.min(range?.last ?? keys.length - 1, keys.length - 1);
  const elements = [];
  for (let i = first; i <= last; i++) {
    const key = keys[i];
    elements.push(
      <View key={key} nativeID={key} collapsable={false} style={wrapper}>
        {i < data.length ? renderItem({ item: data[i], index: i }) : list.ListFooterComponent}
      </View>,
    );
  }
  return (
    <KeyedRow.Provider value={true}>
      <View style={styles.fill} testID="conversation-timeline">
        <HostedView
          style={list.style}
          testID="lab-hosted-mixed"
          onHostedRange={onHostedRange}
          onHostedReady={onHostedReady}
          onLayout={list.onLayout}
          window={{
            keys,
            horizontal,
            top: content.paddingTop ?? 0,
            bottom: content.paddingBottom ?? 0,
            estimate: list.itemSizeEstimate,
          }}
        >
          {elements}
        </HostedView>
      </View>
    </KeyedRow.Provider>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
