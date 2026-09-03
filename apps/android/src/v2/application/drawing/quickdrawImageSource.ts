import type { PreviewLocalFile } from "../preview/previewTransport";
import type { QuickdrawImageSnapshot } from "./quickdrawImage";

export interface QuickdrawImageSource {
  load(source: PreviewLocalFile): Promise<QuickdrawImageSnapshot>;
}
