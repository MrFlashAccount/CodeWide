import CodeWideShared
import Foundation
@testable import CodeWide
import Testing

@MainActor
struct PairingConnectionPickerTests {
    @Test func directConnectionLabelsExplainTheInterface() {
        let endpoint = "wss://192.168.50.172:8767/v1/sync"
        #expect(PairingConnectionPicker.directLabel(endpoint, interfaceName: "en0") ==
            "Wi-Fi · 192.168.50.172:8767")
        #expect(PairingConnectionPicker.directSymbol(endpoint, interfaceName: "en0") == "wifi")
        #expect(PairingConnectionPicker.directLabel(endpoint, interfaceName: "utun4") ==
            "VPN · 192.168.50.172:8767")
        #expect(PairingConnectionPicker.directSymbol(endpoint, interfaceName: "utun4") == "lock.shield")
    }

    @Test func unknownConnectionStillHasAClearDirectLabel() {
        #expect(PairingConnectionPicker.directLabel("not-a-url", interfaceName: "other0") ==
            "Direct · not-a-url")
    }

    @Test func pairingCompletesOnlyWhenANewDeviceAppears() {
        let before: Set<String> = ["existing"]
        #expect(!PairingCompletion.hasNewDevice(before: before, after: before))
        #expect(!PairingCompletion.hasNewDevice(before: before, after: []))
        #expect(PairingCompletion.hasNewDevice(before: before, after: ["existing", "new-device"]))
    }

    @Test func expiredPendingAndFailedCodesAreNotPresentedAsScannable() {
        let now = Date(timeIntervalSince1970: 1_000)
        let valid = PairingPayload(link: "codewide://fixture", expiresAtUnixMilliseconds: 1_001_000)
        let expired = PairingPayload(link: "codewide://fixture", expiresAtUnixMilliseconds: 999_000)

        #expect(PairingPresentation.isUsable(valid, at: now, isRefreshing: false, hasError: false))
        #expect(!PairingPresentation.isUsable(expired, at: now, isRefreshing: false, hasError: false))
        #expect(!PairingPresentation.isUsable(valid, at: now, isRefreshing: true, hasError: false))
        #expect(!PairingPresentation.isUsable(valid, at: now, isRefreshing: false, hasError: true))
    }

    @Test func expiryUsesALiveRelativeCountdown() {
        let now = Date(timeIntervalSince1970: 1_000)
        let pairing = PairingPayload(
            link: "codewide://fixture",
            expiresAtUnixMilliseconds: 1_061_000
        )
        let expired = PairingPayload(
            link: "codewide://fixture",
            expiresAtUnixMilliseconds: 999_000
        )

        #expect(PairingPresentation.expiryText(pairing, at: now) == "Expires in 1:01")
        #expect(PairingPresentation.expiryText(expired, at: now) == "Expired")
    }
}
