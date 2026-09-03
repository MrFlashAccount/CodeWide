import {
  InternalBrowserView,
  type InternalBrowserContentProps,
} from "../../presentation/browser/InternalBrowserView";
import { useEvent } from "../../../react/useEvent";
import { createNativeBrowserDevTools } from "../../infrastructure/ports/nativeBrowserDevTools";
import { useInternalBrowserController } from "../../infrastructure/react/useInternalBrowserController";

const DEVTOOLS = createNativeBrowserDevTools();

/** Binds the transport-neutral browser view to Android WebView and native DevTools. */
export function NativeInternalBrowser(props: InternalBrowserContentProps): React.JSX.Element {
  const { onClose, source } = props;
  const close = useEvent((): void => {
    Promise.resolve(onClose()).catch(() => undefined);
  });
  const controller = useInternalBrowserController({
    capability: DEVTOOLS,
    onClose: close,
    pageUrl: source.uri,
  });
  return <InternalBrowserView {...props} {...controller} />;
}
