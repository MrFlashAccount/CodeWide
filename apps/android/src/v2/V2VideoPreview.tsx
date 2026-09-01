import { VideoPreviewScreen } from "./features/attachments/VideoPreviewScreen";
import type { VideoPreviewRouteModel } from "./features/attachments/videoPreview";
import { ExpoVideoPlayer } from "./platform/rendering/ExpoVideoPlayer";

interface V2VideoPreviewProps {
  model: VideoPreviewRouteModel;
}

export function V2VideoPreview(props: V2VideoPreviewProps): React.JSX.Element {
  const { model } = props;
  return <VideoPreviewScreen model={model} Player={ExpoVideoPlayer} />;
}
