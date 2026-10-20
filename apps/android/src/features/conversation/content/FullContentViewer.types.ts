import type { ContentPresentation } from "../../../services/content/contentRouteSession";

export type FullContentViewerProps = {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  selection: {
    error: string | null;
    loading: boolean;
    nextOffset: number;
    offset: number;
    pointer: string;
    presentation: ContentPresentation;
    reference: { readonly byteLength: number };
    text: string | null;
  };
};
