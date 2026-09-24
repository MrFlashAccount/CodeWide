import CodeWideShared
import Foundation

struct AppServerSelectionStore {
    private struct Selection: Codable {
        let codexHome: String
    }

    private let fileManager: FileManager
    private let stateDirectory: URL
    private let userHome: URL

    init(
        fileManager: FileManager = .default,
        stateDirectory: URL = RuntimeConstants.stateDirectory,
        userHome: URL = FileManager.default.homeDirectoryForCurrentUser
    ) {
        self.fileManager = fileManager
        self.stateDirectory = stateDirectory
        self.userHome = userHome.standardizedFileURL
    }

    var defaultCodexHome: URL {
        userHome.appending(path: ".codex", directoryHint: .isDirectory)
    }

    func load() -> URL {
        guard
            let data = try? Data(contentsOf: selectionURL),
            let selection = try? JSONDecoder().decode(Selection.self, from: data),
            let selected = validatedCodexHome(selection.codexHome)
        else {
            return defaultCodexHome
        }
        return selected
    }

    func save(codexHome: String) throws {
        guard let selected = validatedCodexHome(codexHome) else {
            throw AppServerSelectionError.invalidCodexHome
        }
        try fileManager.createDirectory(
            at: stateDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let data = try JSONEncoder().encode(Selection(codexHome: selected.path))
        try data.write(to: selectionURL, options: .atomic)
        try fileManager.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: selectionURL.path
        )
    }

    private var selectionURL: URL {
        stateDirectory.appending(path: "app-server-selection.json", directoryHint: .notDirectory)
    }

    private func validatedCodexHome(_ path: String) -> URL? {
        let candidate = URL(fileURLWithPath: path, directoryHint: .isDirectory).standardizedFileURL
        let parent = candidate.deletingLastPathComponent()
        let name = candidate.lastPathComponent
        guard
            parent.path == userHome.path,
            name == ".codex" || name.hasPrefix(".codex-")
        else {
            return nil
        }
        return candidate
    }
}

enum AppServerSelectionError: LocalizedError {
    case invalidCodexHome

    var errorDescription: String? {
        "The selected Codex App Server home is outside the supported local locations."
    }
}
