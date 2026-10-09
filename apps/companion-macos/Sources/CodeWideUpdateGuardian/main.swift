import Foundation

guard CommandLine.arguments.count == 3,
      CommandLine.arguments[1] == "--serve" else {
    FileHandle.standardError.write(
        Data("Usage: CodeWideUpdateGuardian --serve <updater-root>\n".utf8)
    )
    exit(EXIT_FAILURE)
}

let root = URL(
    fileURLWithPath: CommandLine.arguments[2],
    isDirectory: true
).resolvingSymlinksInPath()

do {
    let guardian = try Guardian(root: root)
    await guardian.serve()
} catch {
    FileHandle.standardError.write(Data("CodeWideUpdateGuardian: \(error)\n".utf8))
    exit(EXIT_FAILURE)
}
