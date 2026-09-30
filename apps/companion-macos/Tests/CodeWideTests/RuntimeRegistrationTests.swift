import Foundation
import Testing
@testable import CodeWide

@Suite @MainActor
struct RuntimeRegistrationTests {
    @Test func bundleFingerprintTracksLocationAndHelperSignature() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "codewide-registration-\(UUID().uuidString)")
        let suite = "dev.codewide.registration-test.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }

        let first = try makeBundle(at: root.appending(path: "first/CodeWide.app"))
        let original = try #require(RuntimeRegistration.current(bundle: first, defaults: defaults))
        #expect(original.needsUpdate)
        original.confirmHealthyRuntime()
        #expect(!original.needsUpdate)
        let unchanged = try #require(RuntimeRegistration.current(bundle: first, defaults: defaults))
        #expect(!unchanged.needsUpdate)

        // An idle copy elsewhere is irrelevant. Starting that copy must bind its
        // own helper even when the build number and signed executables match.
        let second = try makeBundle(at: root.appending(path: "second/CodeWide.app"))
        #expect(!original.needsUpdate)
        let relocated = try #require(RuntimeRegistration.current(bundle: second, defaults: defaults))
        #expect(relocated.needsUpdate)
        relocated.confirmHealthyRuntime()
        #expect(!relocated.needsUpdate)
        #expect(original.needsUpdate)

        // Developer builds can replace a helper without bumping CFBundleVersion.
        let runtime = second.bundleURL.appending(path: "Contents/MacOS/CodeWideRuntime")
        try FileManager.default.removeItem(at: runtime)
        try FileManager.default.copyItem(atPath: "/usr/bin/false", toPath: runtime.path)
        let changed = try #require(RuntimeRegistration.current(bundle: second, defaults: defaults))
        #expect(changed.needsUpdate)
        #expect(changed.build != relocated.build)
    }

    private func makeBundle(at url: URL) throws -> Bundle {
        let contents = url.appending(path: "Contents")
        let executables = contents.appending(path: "MacOS")
        let agents = contents.appending(path: "Library/LaunchAgents")
        try FileManager.default.createDirectory(at: executables, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let info: [String: String] = [
            "CFBundleIdentifier": "dev.codewide.app",
            "CFBundleExecutable": "CodeWide",
            "CFBundleVersion": "1",
            "CFBundlePackageType": "APPL",
        ]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: contents.appending(path: "Info.plist"))
        try Data("<plist version=\"1.0\"><dict/></plist>".utf8)
            .write(to: agents.appending(path: "dev.codewide.runtime.plist"))
        // Use actual signed system Mach-O files to exercise Security.framework;
        // these fixture executables are never launched or registered.
        for name in ["CodeWide", "CodeWideRuntime"] {
            try FileManager.default.copyItem(atPath: "/usr/bin/true", toPath: executables.appending(path: name).path)
        }
        return try #require(Bundle(url: url))
    }
}
