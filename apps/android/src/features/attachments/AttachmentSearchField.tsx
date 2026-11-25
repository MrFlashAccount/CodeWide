import type { Observable } from "@legendapp/state";
import { SheetSearchField } from "../../ui/SheetSearchField";

/** Filters the current thread's attachment list while the sheet stays open. */
export function AttachmentSearchField({
  query$,
}: {
  readonly query$: Observable<string>;
}): React.JSX.Element {
  return (
    <SheetSearchField
      clearLabel="Clear attachment search"
      label="Search attachments"
      query$={query$}
    />
  );
}
