import { VideoPreviewScreen } from "./features/attachments/VideoPreviewScreen";
import type { VideoPreviewRouteModel } from "./features/attachments/videoPreview";
import { ExpoVideoPlayer } from "./platform/rendering/ExpoVideoPlayer";

export function V2VideoPreview({ model }: { model: VideoPreviewRouteModel }): React.JSX.Element {
  return <VideoPreviewScreen model={model} Player={ExpoVideoPlayer} />;
}
