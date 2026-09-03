import { useEvent } from "../../../react/useEvent";
import { PagedTextViewer, type PagedTextPage } from "../../presentation/output/PagedTextViewer";

export type ItemOutputPage = PagedTextPage;

export interface ItemOutputViewerProps {
  copyText(value: string): Promise<void>;
  itemId: string;
  initialPage: ItemOutputPage;
  loadPage(turnId: string, itemId: string, cursor: string): Promise<ItemOutputPage>;
  onClose(): void;
  turnId: string;
}

/** Binds the generic paged text surface to one exact turn item. */
export function ItemOutputViewer(props: ItemOutputViewerProps): React.JSX.Element {
  const { copyText, initialPage, itemId, loadPage, onClose, turnId } = props;
  const loadBoundPage = useEvent((cursor: string) => loadPage(turnId, itemId, cursor));
  return (
    <PagedTextViewer
      contentName="output"
      copyText={copyText}
      emptyLabel="No output."
      initialPage={initialPage}
      loadPage={loadBoundPage}
      onClose={onClose}
      title="Full output"
    />
  );
}
