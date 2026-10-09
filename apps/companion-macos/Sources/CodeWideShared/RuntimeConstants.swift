import Foundation

public enum RuntimeConstants {
    public static let e2eManifestBaseEnvironmentName =
        "CODEWIDE_HOST_UPDATE_E2E_MANIFEST_BASE_URL"

    #if CODEWIDE_E2E_NAMESPACE
    public static let appBundleIdentifier = "dev.codewide.app.e2e"
    public static let runtimeSigningIdentifier = "dev.codewide.runtime.e2e"
    public static let runtimeLaunchAgentLabel = "dev.codewide.runtime.e2e"
    public static let appCodeSigningRequirement = #"identifier "dev.codewide.app.e2e""#
    public static let runtimeCodeSigningRequirement = #"identifier "dev.codewide.runtime.e2e""#
    public static let machServiceName = "dev.codewide.runtime.control.e2e"
    public static let launchAgentPlistName = "dev.codewide.runtime.e2e.plist"
    public static let guardianLaunchAgentLabel = "dev.codewide.update-guardian.e2e"
    public static let guardianLaunchAgentPlistName = "dev.codewide.update-guardian.e2e.plist"
    public static let companionListenAddress = "127.0.0.1:0"
    private static let applicationSupportTreeName = "CodeWideE2E"
    #else
    public static let appBundleIdentifier = "dev.codewide.app"
    public static let runtimeSigningIdentifier = "dev.codewide.runtime"
    public static let runtimeLaunchAgentLabel = "dev.codewide.runtime"
    public static let appCodeSigningRequirement = #"identifier "dev.codewide.app""#
    public static let runtimeCodeSigningRequirement = #"identifier "dev.codewide.runtime""#
    public static let machServiceName = "dev.codewide.runtime.control"
    public static let launchAgentPlistName = "dev.codewide.runtime.plist"
    public static let guardianLaunchAgentLabel = "dev.codewide.update-guardian"
    public static let guardianLaunchAgentPlistName = "dev.codewide.update-guardian.plist"
    public static let companionListenAddress = "0.0.0.0:8767"
    private static let applicationSupportTreeName = "CodeWide"
    #endif

    public static let guardianExecutableName = "CodeWideUpdateGuardian"

    /// Accepts only a loopback HTTP origin used by the compile-time E2E namespace.
    public static func validatedE2EManifestBaseURL(_ rawValue: String?) -> URL? {
        guard let rawValue,
              let url = URL(string: rawValue),
              url.scheme == "http",
              url.host == "127.0.0.1",
              url.port != nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil else {
            return nil
        }
        return url
    }

    public static var stateDirectory: URL {
        FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: applicationSupportTreeName, directoryHint: .isDirectory)
        .appending(path: "Companion", directoryHint: .isDirectory)
    }

    public static var updaterDirectory: URL {
        FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: applicationSupportTreeName, directoryHint: .isDirectory)
        .appending(path: "Updater", directoryHint: .isDirectory)
    }
}
