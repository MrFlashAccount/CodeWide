import Darwin
import Foundation

struct AppBundleMetadata {
    let bundleURL: URL
    let version: String

    static func currentExecutableURL() throws -> URL {
        var capacity: UInt32 = 0
        _ = _NSGetExecutablePath(nil, &capacity)
        guard capacity > 0 else {
            throw MetadataError.executablePathUnavailable
        }
        var buffer = [CChar](repeating: 0, count: Int(capacity))
        let result = buffer.withUnsafeMutableBufferPointer { storage in
            guard let address = storage.baseAddress else {
                return Int32(-1)
            }
            return _NSGetExecutablePath(address, &capacity)
        }
        guard result == 0 else {
            throw MetadataError.executablePathUnavailable
        }
        let executableURL = buffer.withUnsafeBufferPointer { storage -> URL? in
            guard let address = storage.baseAddress else {
                return nil
            }
            return URL(
                fileURLWithFileSystemRepresentation: address,
                isDirectory: false,
                relativeTo: nil
            )
        }
        guard let executableURL else {
            throw MetadataError.executablePathUnavailable
        }
        return executableURL.resolvingSymlinksInPath()
    }

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
        case executablePathUnavailable
        case invalidInfoPlist(URL)

        var errorDescription: String? {
            switch self {
            case .executablePathUnavailable:
                "The current runtime executable path is unavailable."
            case let .invalidInfoPlist(url):
                "Invalid app metadata at \(url.path)"
            }
        }
    }
}
