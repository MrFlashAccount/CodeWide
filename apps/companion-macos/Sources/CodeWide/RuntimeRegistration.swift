import CodeWideShared
import CryptoKit
import Foundation
import Security

@MainActor
final class RuntimeRegistration {
    let build: String
    private let read: () -> String?
    private let write: (String) -> Void

    init(build: String, read: @escaping () -> String?, write: @escaping (String) -> Void) {
        self.build = build
        self.read = read
        self.write = write
    }

    var needsUpdate: Bool { read() != build }

    func confirmHealthyRuntime() {
        if needsUpdate { write(build) }
    }

    static func current(
        bundle: Bundle = .main,
        defaults: UserDefaults = .standard
    ) -> RuntimeRegistration? {
        guard bundle.bundleIdentifier == RuntimeConstants.appBundleIdentifier else { return nil }
        let bundleURL = bundle.bundleURL.resolvingSymlinksInPath()
        guard
            let appURL = bundle.executableURL,
            let appSignature = signature(of: appURL),
            let runtimeSignature = signature(of: bundleURL.appending(path: "Contents/MacOS/CodeWideRuntime")),
            let agentPlist = try? Data(contentsOf: bundleURL.appending(
                path: "Contents/Library/LaunchAgents/\(RuntimeConstants.launchAgentPlistName)"
            ))
        else { return nil }
        let version = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let input = [bundleURL.path, version, appSignature, runtimeSignature,
                     agentPlist.base64EncodedString()].joined(separator: "\0")
        let build = SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
        let key = "healthyRuntimeRegistration"
        return RuntimeRegistration(
            build: build,
            read: { defaults.string(forKey: key) },
            write: { defaults.set($0, forKey: key) }
        )
    }

    private static func signature(of url: URL) -> String? {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess,
              let code else { return nil }
        var raw: CFDictionary?
        guard SecCodeCopySigningInformation(
            code, SecCSFlags(rawValue: kSecCSSigningInformation), &raw
        ) == errSecSuccess,
              let information = raw as? [String: Any],
              let hash = information[kSecCodeInfoUnique as String] as? Data else { return nil }
        return hash.base64EncodedString()
    }
}
