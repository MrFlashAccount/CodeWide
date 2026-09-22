import Foundation

public enum RuntimeConstants {
    public static let appBundleIdentifier = "dev.codewide.app"
    public static let runtimeSigningIdentifier = "dev.codewide.runtime"
    public static let appCodeSigningRequirement = #"identifier "dev.codewide.app""#
    public static let runtimeCodeSigningRequirement = #"identifier "dev.codewide.runtime""#
    public static let machServiceName = "dev.codewide.runtime.control"
    public static let launchAgentPlistName = "dev.codewide.runtime.plist"

    public static var stateDirectory: URL {
        FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: "CodeWide", directoryHint: .isDirectory)
        .appending(path: "Companion", directoryHint: .isDirectory)
    }
}
