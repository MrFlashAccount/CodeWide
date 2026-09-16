import type { RenderContentReference } from "@codewide/renderers";
import type { LargeContentViewerRequest } from "./contentViewerContext";

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
    presentation: LargeContentViewerRequest["presentation"];
    reference: RenderContentReference;
    text: string | null;
  };
};
