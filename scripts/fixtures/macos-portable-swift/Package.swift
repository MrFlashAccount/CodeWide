// swift-tools-version: 6.2

import PackageDescription

// The local checker stages unchanged production/test files here. It deliberately
// excludes Apple SDK owners rather than pretending to provide their frameworks.
let package = Package(
    name: "CodeWidePortablePreflight",
    targets: [
        .target(name: "CodeWideShared"),
        .target(name: "CodeWide", dependencies: ["CodeWideShared"]),
        .testTarget(name: "CodeWidePortableTests", dependencies: ["CodeWide", "CodeWideShared"]),
    ],
    swiftLanguageModes: [.v6]
)
