import AppKit
import CodeWideShared
import SwiftUI

struct CompanionPanel: View {
    @ObservedObject var runtime: RuntimeConnection
    @ObservedObject var updates: UpdateController
    @ObservedObject var onboarding: OnboardingWindowController
    @ObservedObject var dialogs: CompanionDialogController
    @ObservedObject var keepAwake: KeepAwakeController
    @ObservedObject var launchAtLogin: LaunchAtLoginController

    @State private var actionError: String?
    @State private var actionInProgress = false

    var body: some View {
        CompanionMenuView(
            snapshot: snapshot,
            primaryAction: performPrimaryAction,
            revokeDevice: removeDevice,
            actionsIdentity: actionsIdentity,
            moreActions: { moreActions }
        )
        .onAppear {
            launchAtLogin.refreshStatus()
            updates.checkForUpdatesSilentlyIfNeeded()
        }
        .task { await runtime.discoverAppServers() }
    }

    private var actionsIdentity: CompanionActionMenuIdentity {
        CompanionActionMenuIdentity(
            appVersion: runtime.health?.appVersion,
            runtimeAvailable: runtime.health != nil,
            requiresApproval: runtime.requiresApproval,
            profiles: runtime.appServers.map {
                CompanionActionMenuIdentity.Profile(
                    id: $0.id,
                    displayName: $0.displayName,
                    isAvailable: $0.state.isAvailable,
                    isSelected: $0.selected
                )
            },
            relayConfigured: runtime.relay?.configured == true,
            relayEnabled: runtime.relay?.enabled == true,
            canCheckForUpdates: updates.canCheckForUpdates,
            isCheckingForUpdates: updates.isCheckingForUpdates,
            actionInProgress: actionInProgress,
            keepAwakePolicy: keepAwake.policy.rawValue,
            keepAwakeStatus: keepAwake.statusSummary,
            launchAtLoginEnabled: launchAtLogin.isEnabled,
            launchAtLoginRequiresApproval: launchAtLogin.requiresApproval,
            launchAtLoginChanging: launchAtLogin.isChanging
        )
    }

    private var snapshot: CompanionMenuSnapshot {
        var value = CompanionMenuSnapshot()
        value.connection = CompanionMenuConnection(
            health: runtime.health,
            server: runtime.appServer,
            directAccess: runtime.directAccess,
            relay: runtime.relay,
            requiresApproval: runtime.requiresApproval,
            runtimeStatus: runtime.status
        )
        value.directStatus = CompanionDirectStatus(runtime.directAccess)
        value.relayStatus = CompanionRelayStatus(runtime.relay)
        value.devices = runtime.devices
        value.profileName = runtime.appServer?.displayName ?? "None selected"
        value.serverVersion = runtime.appServer?.state.version
        value.appVersion = runtime.health?.appVersion
        value.coreVersion = runtime.health?.coreVersion
        if let endpoint = runtime.pairingEndpoint, let url = URL(string: endpoint), let host = url.host {
            value.address = url.port.map { "\(host):\($0)" } ?? host
        }
        value.availableUpdate = updates.availableVersion
        value.isWorking = actionInProgress
        value.canManageDevices = runtime.health?.phase == "running"
        if let error = actionError {
            value.noticeTitle = "Action couldn't finish"
            value.notice = error
        } else if let error = runtime.lastError {
            value.noticeTitle = "Connection needs attention"
            value.notice = error
        } else if let error = keepAwake.lastError {
            value.noticeTitle = "Keep Awake needs attention"
            value.notice = error
        } else if let error = launchAtLogin.lastError {
            value.noticeTitle = "Launch at Login needs attention"
            value.notice = error
        } else if let error = updates.lastError {
            value.noticeTitle = "Update couldn't finish"
            value.notice = error
        }
        return value
    }

    @ViewBuilder private var moreActions: some View {
        if let version = runtime.health?.appVersion {
            Text("CodeWide \(version)")
            Divider()
        }
        Button("Refresh Connection", systemImage: "arrow.clockwise") { refresh() }
            .disabled(actionInProgress)
        Button("Open Setup…", systemImage: "slider.horizontal.3") { onboarding.show() }
        Toggle("Launch at Login", isOn: Binding(
            get: { launchAtLogin.isEnabled },
            set: { enabled in
                Task { await launchAtLogin.setEnabled(enabled) }
            }
        ))
        .disabled(launchAtLogin.isChanging)
        Menu("Keep This Mac Awake", systemImage: "moon.zzz") {
            ForEach(KeepAwakePolicy.allCases) { policy in
                Button {
                    keepAwake.setPolicy(policy)
                } label: {
                    if keepAwake.policy == policy {
                        Label(policy.title, systemImage: "checkmark")
                    } else {
                        Text(policy.title)
                    }
                }
            }
            Divider()
            Text(keepAwake.statusSummary)
        }
        if runtime.requiresApproval || launchAtLogin.requiresApproval {
            Button("Open Login Items…") { launchAtLogin.openLoginItemsSettings() }
        }
        if runtime.appServers.count > 1 {
            Menu("Codex Profile") {
                ForEach(runtime.appServers, id: \.id) { server in
                    Button {
                        runAction { try await runtime.selectAppServer(id: server.id) }
                    } label: {
                        if server.selected {
                            Label(server.displayName, systemImage: "checkmark")
                        } else {
                            Text(server.displayName + (server.state.isAvailable ? "" : " · Unavailable"))
                        }
                    }
                    .disabled(!server.state.isAvailable || server.selected || actionInProgress || runtime.health == nil)
                }
                Divider()
                Button("Scan Again") { Task { await runtime.discoverAppServers() } }
            }
        }
        Divider()
        Button {
            updates.checkForUpdates()
        } label: {
            if let version = updates.availableVersion {
                Label("Install \(version)…", systemImage: "arrow.down.circle.fill")
            } else {
                Text("Check for Updates…")
            }
        }
        .disabled(!updates.canCheckForUpdates || updates.isCheckingForUpdates)
        Menu("Advanced") {
            Button(runtime.relay?.configured == true ? "Change Relay…" : "Add Relay…") {
                dialogs.showRelaySetup()
            }
            if runtime.relay?.configured == true {
                Button(runtime.relay?.enabled == true ? "Disable Relay" : "Enable Relay") {
                    runAction { try await runtime.setRelayEnabled(runtime.relay?.enabled != true) }
                }
                .disabled(actionInProgress)
            }
        }
        Divider()
        Button("Quit CodeWide") { NSApplication.shared.terminate(nil) }
            .keyboardShortcut("q")
    }

    private func performPrimaryAction() {
        switch snapshot.connection {
        case .connected:
            runAction {
                let pairing = try await runtime.createPairing(route: runtime.preferredPairingRoute)
                dialogs.showPairing(pairing)
            }
        case .needsPermission: runtime.openLoginItemsSettings()
        case .codexUnavailable: onboarding.show()
        case .helperUnavailable, .networkUnavailable: refresh()
        case .starting: break
        }
    }

    private func refresh() {
        runAction {
            await runtime.refresh()
            await runtime.discoverAppServers()
        }
    }

    private func removeDevice(_ device: DeviceStatusPayload) {
        guard CompanionNativeDialog.confirmDestructive(
            title: "Remove \(device.name)?",
            message: "It will lose access to this Mac. Scan a new QR code to connect it again.",
            actionTitle: "Remove Device"
        ) else { return }
        runAction { try await runtime.revokeDevice(id: device.id) }
    }

    private func runAction(_ action: @escaping @MainActor () async throws -> Void) {
        guard !actionInProgress else { return }
        actionInProgress = true
        actionError = nil
        Task {
            defer { actionInProgress = false }
            do { try await action() }
            catch { actionError = error.localizedDescription }
        }
    }
}
