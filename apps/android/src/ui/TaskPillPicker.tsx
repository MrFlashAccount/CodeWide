import { useState, type ReactElement, type ReactNode } from "react";
import { useEvent } from "../react/useEvent";
import { AnchoredMenuList } from "./AnchoredMenuList";
import { ContentMenu } from "./ContentMenu";
import type { ContentMenuProps } from "./ContentMenu.types";
import { useAnchoredMenuSize } from "./useAnchoredMenuSize";

type PickerMenuProps = Pick<ContentMenuProps, "anchorStyle" | "placement"> & {
  readonly children: (close: () => void) => ReactNode;
  readonly listTestID: string;
  readonly renderTrigger: (open: boolean, toggle: () => void) => ContentMenuProps["trigger"];
  readonly title?: string;
};

/** A single task or agent opens directly. Multiple entries share one anchored picker. */
export function TaskPillPicker<Entry>({
  entries,
  renderSingle,
  ...menu
}: PickerMenuProps & {
  readonly entries: readonly Entry[];
  readonly renderSingle: (entry: Entry) => ReactElement;
}): ReactElement | null {
  const [first] = entries;
  if (first === undefined) {
    return null;
  }
  return entries.length === 1 ? renderSingle(first) : <TaskPillMenu {...menu} />;
}

function TaskPillMenu({
  children,
  listTestID,
  renderTrigger,
  title,
  ...anchor
}: PickerMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const { width } = useAnchoredMenuSize();
  const toggle = useEvent(() => {
    setOpen((current) => !current);
  });
  const close = useEvent(() => {
    setOpen(false);
  });
  return (
    <ContentMenu
      {...anchor}
      align="center"
      onOpenChange={setOpen}
      open={open}
      trigger={renderTrigger(open, toggle)}
      width={width}
    >
      <AnchoredMenuList testID={listTestID} {...(title === undefined ? {} : { title })}>
        {children(close)}
      </AnchoredMenuList>
    </ContentMenu>
  );
}
