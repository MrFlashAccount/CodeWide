import "./src/polyfills/secure-crypto";
import "./src/ui/install-global-error-handler";
import "./src/ui/registerAppNoticeOverlay";
import { holdStartupSplash } from "./src/boot/startupSplash";

holdStartupSplash();
// Router registers the React root on evaluation and can release the splash once navigation is ready.
require("expo-router/entry");
