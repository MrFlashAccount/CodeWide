import Foundation

struct AppBundleMetadata {
    let bundleURL: URL
    let version: String

    static func load(runtimeExecutableURL: URL) throws -> Self {
        let bundleURL = runtimeExecutableURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let infoURL = bundleURL.appending(path: "Contents/Info.plist")
        let data = try Data(contentsOf: infoURL)
        let raw = try PropertyListSerialization.propertyList(from: data, format: nil)
        guard
            let info = raw as? [String: Any],
            let version = info["CFBundleShortVersionString"] as? String,
            !version.isEmpty
        else {
            throw MetadataError.invalidInfoPlist(infoURL)
        }
        return Self(bundleURL: bundleURL, version: version)
    }

    enum MetadataError: LocalizedError {
        case invalidInfoPlist(URL)

        var errorDescription: String? {
            switch self {
            case let .invalidInfoPlist(url):
                "Invalid app metadata at \(url.path)"
            }
        }
    }
}
