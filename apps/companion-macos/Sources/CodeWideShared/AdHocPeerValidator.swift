import Darwin
import Foundation
import Security

public enum AdHocPeerValidator {
    public static func acceptsRuntimeExecutable(
        _ executableURL: URL,
        appBundleURL: URL
    ) -> Bool {
        let normalizedExecutable = executableURL.resolvingSymlinksInPath()
        let expectedExecutable = appBundleURL
            .appending(path: "Contents/MacOS/CodeWideRuntime")
            .resolvingSymlinksInPath()
        guard normalizedExecutable == expectedExecutable else {
            return false
        }
        var staticCode: SecStaticCode?
        guard
            SecStaticCodeCreateWithPath(normalizedExecutable as CFURL, [], &staticCode)
                == errSecSuccess,
            let staticCode,
            SecStaticCodeCheckValidity(
                staticCode,
                SecCSFlags(rawValue: kSecCSStrictValidate),
                nil
            ) == errSecSuccess
        else {
            return false
        }
        var rawInformation: CFDictionary?
        guard
            SecCodeCopySigningInformation(
                staticCode,
                SecCSFlags(rawValue: kSecCSSigningInformation),
                &rawInformation
            ) == errSecSuccess,
            let information = rawInformation as? [String: Any]
        else {
            return false
        }
        return information[kSecCodeInfoIdentifier as String] as? String
            == RuntimeConstants.runtimeSigningIdentifier
    }

    public static func acceptsAppClient(
        _ connection: NSXPCConnection,
        runtimeExecutableURL: URL
    ) -> Bool {
        guard connection.effectiveUserIdentifier == geteuid() else {
            return false
        }
        let processID = connection.processIdentifier
        guard processID > 0 else {
            return false
        }

        let attributes = [
            kSecGuestAttributePid as String: NSNumber(value: processID),
        ] as CFDictionary
        var guestCode: SecCode?
        guard
            SecCodeCopyGuestWithAttributes(nil, attributes, [], &guestCode) == errSecSuccess,
            let guestCode
        else {
            return false
        }
        guard SecCodeCheckValidity(guestCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil)
            == errSecSuccess
        else {
            return false
        }

        var rawInformation: CFDictionary?
        guard
            SecCodeCopySigningInformation(
                guestCode,
                SecCSFlags(rawValue: kSecCSSigningInformation),
                &rawInformation
            ) == errSecSuccess,
            let information = rawInformation as? [String: Any],
            information[kSecCodeInfoIdentifier as String] as? String
                == RuntimeConstants.appBundleIdentifier,
            let clientExecutable = information[kSecCodeInfoMainExecutable as String] as? URL
        else {
            return false
        }

        let expectedBundle = runtimeExecutableURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .resolvingSymlinksInPath()
        let clientPath = clientExecutable.resolvingSymlinksInPath().path
        return clientPath.hasPrefix(expectedBundle.path + "/Contents/MacOS/")
    }
}
