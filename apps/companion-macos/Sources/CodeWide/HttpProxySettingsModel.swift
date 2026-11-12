import Combine
import Foundation

@MainActor
final class HttpProxySettingsModel: ObservableObject {
    @Published var httpProxy = ""
    @Published var httpsProxy = ""
    @Published var noProxy = ""
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published private(set) var error: String?

    private let runtime: RuntimeConnection
    private var loaded = false

    init(runtime: RuntimeConnection) {
        self.runtime = runtime
    }

    var canSave: Bool {
        loaded && !isLoading && !isSaving && (
            noProxy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !httpProxy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !httpsProxy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }

    func load() async {
        guard !loaded, !isLoading else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let settings = try await runtime.httpProxySettings()
            httpProxy = settings.httpProxy ?? ""
            httpsProxy = settings.httpsProxy ?? ""
            noProxy = settings.noProxy ?? ""
            loaded = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    func save() async -> Bool {
        guard canSave else { return false }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await runtime.setHttpProxySettings(CompanionHttpProxySettings(
                httpProxy: httpProxy,
                httpsProxy: httpsProxy,
                noProxy: noProxy
            ))
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
