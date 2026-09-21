// swift-tools-version: 6.2

import Foundation
import PackageDescription

let ffiArchive = ProcessInfo.processInfo.environment["CODEWIDE_FFI_ARCHIVE"]

let ffiLinkerSettings: [LinkerSetting] = ffiArchive.map {
    [
        .unsafeFlags([$0]),
        .linkedFramework("CoreFoundation"),
        .linkedFramework("Security"),
    ]
} ?? []

let package = Package(
    name: "CodeWideMac",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "CodeWide", targets: ["CodeWide"]),
        .executable(name: "CodeWideRuntime", targets: ["CodeWideRuntime"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .systemLibrary(
            name: "companion_swift_ffiFFI",
            path: "Sources/CompanionSwiftFFIFFI"
        ),
        .target(
            name: "CompanionSwiftFFI",
            dependencies: ["companion_swift_ffiFFI"],
            path: "Sources/CompanionSwiftFFI",
            linkerSettings: ffiLinkerSettings
        ),
        .target(
            name: "CodeWideShared",
            path: "Sources/CodeWideShared"
        ),
        .executableTarget(
            name: "CodeWide",
            dependencies: [
                "CodeWideShared",
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            path: "Sources/CodeWide"
        ),
        .executableTarget(
            name: "CodeWideRuntime",
            dependencies: ["CodeWideShared", "CompanionSwiftFFI"],
            path: "Sources/CodeWideRuntime"
        ),
        .testTarget(
            name: "CodeWideSharedTests",
            dependencies: ["CodeWideShared"],
            path: "Tests/CodeWideSharedTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
