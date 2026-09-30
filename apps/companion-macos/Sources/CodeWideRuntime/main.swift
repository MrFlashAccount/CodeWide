import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation
import OSLog

let runtimeLogger = Logger(subsystem: RuntimeConstants.appBundleIdentifier, category: "Runtime")

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
        computerName: computerName,
        listenAddress: "0.0.0.0:8767"
    )
    runtimeLogger.notice("Companion network listener is ready on 0.0.0.0:8767")
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
    runtimeLogger.error("Companion startup failed: \(String(describing: error), privacy: .private)")
    FileHandle.standardError.write(Data("CodeWideRuntime: \(error)\n".utf8))
    exit(EXIT_FAILURE)
}
