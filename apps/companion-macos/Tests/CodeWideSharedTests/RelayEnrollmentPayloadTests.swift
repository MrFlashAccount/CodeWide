import CodeWideShared
import Foundation
import Testing

@Test func relayEnrollmentSymbolsSurviveSecureXPCArchiving() throws {
    let symbols = "🍋  🚀  🐳  🎸\nLemon · Rocket · Whale · Guitar"
    let payload = RelayEnrollmentPayload(
        id: String(repeating: "a", count: 64), state: "confirm",
        code: symbols, remainingSeconds: 35, message: nil
    )
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: payload, requiringSecureCoding: true
    )
    let object = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: RelayEnrollmentPayload.self, from: data
    )
    let decoded = try #require(object)
    #expect(decoded.id == payload.id)
    #expect(decoded.state == "confirm")
    #expect(decoded.code == symbols)
    #expect(decoded.remainingSeconds == 35)
    #expect(decoded.message == nil)
}
