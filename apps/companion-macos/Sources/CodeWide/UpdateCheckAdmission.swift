import Foundation

/// Keeps menu probes from claiming the updater session used by an installation test.
struct UpdateCheckAdmission {
    enum Mode {
        case interactive
        case installationTest
    }

    let mode: Mode
    private var lastProbeAt: Date?

    init(mode: Mode) {
        self.mode = mode
    }

    mutating func admitInformationProbe(
        now: Date,
        canCheckForUpdates: Bool,
        sessionInProgress: Bool
    ) -> Bool {
        guard mode == .interactive,
              canCheckForUpdates,
              !sessionInProgress,
              lastProbeAt.map({ now.timeIntervalSince($0) >= 60 * 60 }) ?? true else {
            return false
        }
        lastProbeAt = now
        return true
    }
}
