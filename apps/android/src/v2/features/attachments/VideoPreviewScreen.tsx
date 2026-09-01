import type { ComponentType } from "react";

import { VideoPreviewView } from "../../presentation/preview/VideoPreviewView";
import type { VideoPlaybackSource, VideoPreviewRouteModel } from "./videoPreview";

export interface VideoPlayerCapabilityProps {
  autoplay: boolean;
  source: VideoPlaybackSource;
  title: string;
}

export interface VideoPreviewScreenProps {
  model: VideoPreviewRouteModel;
  Player: ComponentType<VideoPlayerCapabilityProps>;
}

export function VideoPreviewScreen(props: VideoPreviewScreenProps): React.JSX.Element {
  const { model, Player } = props;
  return (
    <VideoPreviewView title={model.name}>
      <Player autoplay source={model.source} title={model.name} />
    </VideoPreviewView>
  );
}
