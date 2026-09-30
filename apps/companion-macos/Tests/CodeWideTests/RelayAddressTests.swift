import Foundation
import Testing
@testable import CodeWide

struct RelayAddressTests {
    @Test(arguments: ["relay.example:8780", "192.0.2.1:8780", "relay.example:443", "relay.example:80", "[::1]:8780"])
    func acceptsReachableAddressForms(address: String) throws {
        #expect(try RelayAddress.normalized(address) == address)
        #expect(try RelayAddress.normalized(" \n\(address)\n ") == address)
    }

    @Test(arguments: ["Monitor", "relay.example", "relay.example:", "relay.example:0",
                      "relay.example:65536", "relay.example:port", ":8780", "wss://relay.example:8780",
                      "relay.example:8780/path", "user:private-password@relay.example:8780", "relay.\nexample:8780"])
    func invalidInputExplainsTheRequiredAddress(address: String) {
        do {
            _ = try RelayAddress.normalized(address)
            Issue.record("An invalid Relay address was accepted")
        } catch {
            #expect(error.localizedDescription.contains("DNS name or IP address and port"))
            #expect(error.localizedDescription.contains("SSH aliases"))
            #expect(!error.localizedDescription.contains("private-password"))
        }
    }
}
