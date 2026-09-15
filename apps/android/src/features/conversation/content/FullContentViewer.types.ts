import { type RenderContentReference } from "@codewide/renderers";
import { type LargeContentViewerRequest } from "./contentViewerContext";

export type FullContentViewerProps = {
  selection: {
    pointer: string;
    reference: RenderContentReference;
    presentation: LargeContentViewerRequest["presentation"];
    offset: number;
    nextOffset: number;
    text: string | null;
    loading: boolean;
    error: string | null;
  };
  onClose(): void;
  onPrevious(): void;
  onNext(): void;
};
