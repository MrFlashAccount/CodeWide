import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation

do {
    let executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    let metadata = try AppBundleMetadata.load(runtimeExecutableURL: executableURL)
    let core = try CoreHost(
        stateDirectory: RuntimeConstants.stateDirectory.path,
        appVersion: metadata.version,
        hostVersion: metadata.version
    )
    let service = RuntimeService(core: core, runtimeExecutablePath: executableURL.path)
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
