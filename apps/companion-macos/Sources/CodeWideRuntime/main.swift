import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation

do {
    let executableURL = try AppBundleMetadata.currentExecutableURL()
    let metadata = try AppBundleMetadata.load(runtimeExecutableURL: executableURL)
    let userHome = FileManager.default.homeDirectoryForCurrentUser
    let selectionStore = AppServerSelectionStore(userHome: userHome)
    let selectedCodexHome = selectionStore.load()
    let computerName = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    let core = try CoreHost(
        stateDirectory: RuntimeConstants.stateDirectory.path,
        codexHome: selectedCodexHome.path,
        appVersion: metadata.version,
        hostVersion: metadata.version,
        computerName: computerName
    )
    let service = RuntimeService(
        core: core,
        runtimeExecutablePath: executableURL.path,
        selectionStore: selectionStore,
        selectedCodexHome: selectedCodexHome,
        userHome: userHome
    )
    let delegate = RuntimeListenerDelegate(
        service: service,
        runtimeExecutableURL: executableURL
    )
    let listener = NSXPCListener(machServiceName: RuntimeConstants.machServiceName)
    listener.delegate = delegate
    listener.resume()
    RunLoop.current.run()
} catch {
    FileHandle.standardError.write(Data("CodeWideRuntime: \(error)\n".utf8))
    exit(EXIT_FAILURE)
}
