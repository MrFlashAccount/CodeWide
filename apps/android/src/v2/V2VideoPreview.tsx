import { VideoPreviewScreen } from "./features/attachments/VideoPreviewScreen";
import type { VideoPreviewRouteModel } from "./features/attachments/videoPreview";
import { ExpoVideoPlayer } from "./platform/rendering/ExpoVideoPlayer";

interface V2VideoPreviewProps {
  model: VideoPreviewRouteModel;
}

export function V2VideoPreview({ model }: V2VideoPreviewProps): React.JSX.Element {
  return <VideoPreviewScreen model={model} Player={ExpoVideoPlayer} />;
}
