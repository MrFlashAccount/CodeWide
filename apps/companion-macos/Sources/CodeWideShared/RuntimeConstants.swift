import Foundation

public enum RuntimeConstants {
    #if CODEWIDE_E2E_NAMESPACE
    public static let appBundleIdentifier = "dev.codewide.app.e2e"
    public static let runtimeSigningIdentifier = "dev.codewide.runtime.e2e"
    public static let runtimeLaunchAgentLabel = "dev.codewide.runtime.e2e"
    public static let appCodeSigningRequirement = #"identifier "dev.codewide.app.e2e""#
    public static let runtimeCodeSigningRequirement = #"identifier "dev.codewide.runtime.e2e""#
    public static let machServiceName = "dev.codewide.runtime.control.e2e"
    public static let launchAgentPlistName = "dev.codewide.runtime.e2e.plist"
    public static let legacyGuardianLaunchAgentLabel = "dev.codewide.update-guardian.e2e"
    public static let legacyGuardianLaunchAgentPlistName = "dev.codewide.update-guardian.e2e.plist"
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
    public static let legacyGuardianLaunchAgentLabel = "dev.codewide.update-guardian"
    public static let legacyGuardianLaunchAgentPlistName = "dev.codewide.update-guardian.plist"
    public static let companionListenAddress = "0.0.0.0:8767"
    private static let applicationSupportTreeName = "CodeWide"
    #endif

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
