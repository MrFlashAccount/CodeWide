import Foundation

struct CompanionHttpProxySettings: Codable, Equatable, Sendable {
    let httpProxy: String?
    let httpsProxy: String?
    let noProxy: String?

    init(httpProxy: String?, httpsProxy: String?, noProxy: String?) {
        self.httpProxy = Self.normalized(httpProxy)
        self.httpsProxy = Self.normalized(httpsProxy)
        self.noProxy = Self.normalized(noProxy)
    }

    var isConfigured: Bool {
        httpProxy != nil || httpsProxy != nil
    }

    private static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }
}
