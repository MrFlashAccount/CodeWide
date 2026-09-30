import AppKit
import CodeWideShared
import SwiftUI

/// The menu's rendering boundary. It never discovers services or creates a
/// pairing link merely because the popover appeared.
struct CompanionMenuView<MoreActions: View>: View {
    let snapshot: CompanionMenuSnapshot
    let primaryAction: () -> Void
    let revokeDevice: (DeviceStatusPayload) -> Void
    let actionsIdentity: CompanionActionMenuIdentity
    @ViewBuilder let moreActions: () -> MoreActions

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var showsDetails = false
    @State private var showsNoticeDetails = false
    @State private var dismissedNotice: String?

    init(
        snapshot: CompanionMenuSnapshot,
        primaryAction: @escaping () -> Void,
        revokeDevice: @escaping (DeviceStatusPayload) -> Void,
        initiallyShowsDetails: Bool = false,
        actionsIdentity: CompanionActionMenuIdentity = .empty,
        @ViewBuilder moreActions: @escaping () -> MoreActions
    ) {
        self.snapshot = snapshot
        self.primaryAction = primaryAction
        self.revokeDevice = revokeDevice
        self.actionsIdentity = actionsIdentity
        self.moreActions = moreActions
        _showsDetails = State(initialValue: initiallyShowsDetails)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 18)
            connection
            if showsDetails {
                connectionDetails
                    .padding(.top, 14)
            }
            Divider().padding(.vertical, 18)
            if let notice = snapshot.notice, notice != dismissedNotice {
                noticeView(notice)
                    .padding(.bottom, 16)
            }
            if snapshot.devices.isEmpty || snapshot.connection != .connected {
                guidance
                    .padding(.bottom, 18)
            }
            if !snapshot.devices.isEmpty {
                devices
                    .padding(.bottom, 16)
            }
            GlassEffectContainer { primaryButton }
            reachabilityStatus
                .padding(.top, 12)
        }
        .padding(20)
        .frame(width: 360)
        .fixedSize(horizontal: false, vertical: true)
        // The AppKit panel owns the native glass material and outer shape.
        .tint(CodeWideBrand.accent)
        .onChange(of: snapshot.notice) { _, _ in
            dismissedNotice = nil
            showsNoticeDetails = false
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            CodeWideBrandMark(size: 23)
                .accessibilityHidden(true)
            Text("CodeWide")
                .font(.system(size: 15, weight: .semibold))
            Spacer()
            CompanionActionMenu(
                availableUpdate: snapshot.availableUpdate,
                darkAppearance: colorScheme == .dark,
                identity: actionsIdentity,
                actions: moreActions
            )
            .equatable()
        }
    }

    private var connection: some View {
        Button {
            // Keep the status-item window anchored during disclosure. Animating
            // its intrinsic height also moves its hit-testing bounds mid-click.
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                showsDetails.toggle()
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "terminal")
                    .font(.system(size: 25, weight: .regular))
                    .foregroundStyle(.primary)
                    .frame(width: 34)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Codex")
                        .font(.system(size: 13, weight: .semibold))
                    HStack(spacing: 5) {
                        Image(systemName: connectionSymbol)
                            .font(.system(size: snapshot.connection == .connected ? 6 : 10))
                            .foregroundStyle(connectionColor)
                            .accessibilityHidden(true)
                        if snapshot.connection == .starting {
                            ShimmerText(snapshot.connection.summary)
                        } else {
                            Text(snapshot.connection.summary)
                        }
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(secondaryText)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(secondaryText)
                    .rotationEffect(.degrees(showsDetails ? 90 : 0))
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 6)
        .help("Show connection details")
        .accessibilityLabel("Codex, \(snapshot.connection.summary). Connection details")
        .accessibilityValue(showsDetails ? "Expanded" : "Collapsed")
    }

    private var connectionDetails: some View {
        VStack(spacing: 9) {
            detail("Profile", value: snapshot.profileName)
            if let version = snapshot.serverVersion { detail("Codex", value: version) }
            if let version = snapshot.appVersion { detail("CodeWide", value: version) }
            if let version = snapshot.coreVersion { detail("Core", value: version) }
            if let address = snapshot.address {
                detail("Address", value: address)
            }
        }
        .padding(.horizontal, 6)
    }

    private func detail(_ name: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(name).foregroundStyle(secondaryText)
            Spacer(minLength: 0)
            Text(value)
                .monospacedDigit()
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .help(value)
        }.font(.system(size: 11))
    }

    private var guidance: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(snapshot.connection.title)
                .font(.system(size: 19, weight: .semibold))
                .tracking(-0.3)
                .fixedSize(horizontal: false, vertical: true)
            Text(snapshot.connection.explanation)
                .font(.system(size: 12.5))
                .foregroundStyle(secondaryText)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var devices: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Devices").fontWeight(.semibold)
                Spacer()
                Text(snapshot.devicesSummary)
            }
            .font(.system(size: 11))
            .foregroundStyle(secondaryText)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(snapshot.devices, id: \.id) { device in
                        deviceRow(device)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: CGFloat(min(snapshot.devices.count, 4)) * 56)
        }
    }

    private func deviceRow(_ device: DeviceStatusPayload) -> some View {
        let online = snapshot.connection == .connected && device.activeConnections > 0
        return HStack(spacing: 11) {
            Image(systemName: "iphone")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(secondaryText)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 4) {
                Text(device.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .help(device.name)
                HStack(spacing: 5) {
                    if online {
                        Circle().fill(successColor).frame(width: 5, height: 5)
                    }
                    Text(online ? "Connected" : lastSeen(device))
                        .lineLimit(1)
                }
                .font(.system(size: 11))
                .foregroundStyle(secondaryText)
            }
            Spacer(minLength: 4)
            Menu {
                Button("Remove Device…", role: .destructive) { revokeDevice(device) }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(secondaryText)
                    .frame(width: 24, height: 28)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .tint(secondaryText)
            .glassEffect(.regular.interactive(), in: .circle)
            .disabled(snapshot.isWorking || !snapshot.canManageDevices)
            .accessibilityLabel("Actions for \(device.name)")
        }
        .frame(height: 56)
        .accessibilityElement(children: .contain)
    }

    private var primaryButton: some View {
        Button(action: primaryAction) {
            HStack(spacing: 7) {
                Image(systemName: snapshot.connection.actionSymbol)
                if snapshot.isWorking || snapshot.connection == .starting {
                    ShimmerText(primaryTitle)
                } else {
                    Text(primaryTitle)
                }
            }
            .font(.system(size: 13, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .tint(CodeWideBrand.actionAccent)
        .disabled(snapshot.isWorking || snapshot.connection == .starting)
        .keyboardShortcut("n", modifiers: .command)
    }

    private var reachabilityStatus: some View {
        HStack(spacing: 12) {
            transportStatus(
                "Direct",
                summary: snapshot.directStatus.summary,
                color: snapshot.directStatus == .available ? successColor : secondaryText
            )
            Divider().frame(height: 12)
            transportStatus(
                "Relay",
                summary: snapshot.relayStatus.summary,
                color: relayStatusColor
            )
        }
        .font(.system(size: 11))
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Direct \(snapshot.directStatus.summary). Relay \(snapshot.relayStatus.summary)."
        )
    }

    private func transportStatus(_ name: String, summary: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text("\(name) \(summary)")
                .foregroundStyle(secondaryText)
                .lineLimit(1)
        }
    }

    private func noticeView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.orange)
                Button {
                    showsNoticeDetails.toggle()
                } label: {
                    HStack {
                        Text(snapshot.noticeTitle).fontWeight(.medium)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .semibold))
                            .rotationEffect(.degrees(showsNoticeDetails ? 180 : 0))
                    }
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                Button {
                    dismissedNotice = message
                } label: {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                        .frame(width: 20, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss notice")
            }
            if showsNoticeDetails {
                ScrollView {
                    Text(message)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxHeight: 96)
            }
        }
        .font(.system(size: 11))
        .padding(10)
        .background(.orange.opacity(colorScheme == .dark ? 0.08 : 0.07), in: RoundedRectangle(cornerRadius: 9))
        .help(message)
    }

    private var primaryTitle: String {
        if snapshot.connection == .connected && !snapshot.devices.isEmpty { return "Connect a Device" }
        return snapshot.connection.actionTitle
    }

    private var connectionColor: Color {
        switch snapshot.connection {
        case .connected: successColor
        case .starting: secondaryText
        default: .orange
        }
    }

    private var secondaryText: Color {
        Color(white: colorScheme == .dark ? 0.67 : 0.40)
    }

    private var successColor: Color {
        colorScheme == .dark ? Color(red: 0.27, green: 0.80, blue: 0.37)
            : Color(red: 0.13, green: 0.53, blue: 0.23)
    }

    private var relayStatusColor: Color {
        switch snapshot.relayStatus {
        case .connected: successColor
        case .connecting, .unavailable: .orange
        case .disabled, .notConfigured: secondaryText
        }
    }

    private var connectionSymbol: String {
        switch snapshot.connection {
        case .connected: "circle.fill"
        case .starting: "circle.dotted"
        default: "exclamationmark.circle.fill"
        }
    }

    private func lastSeen(_ device: DeviceStatusPayload) -> String {
        guard snapshot.connection == .connected else { return "Status unavailable" }
        guard device.lastSeenAtUnixMilliseconds > 0 else { return "Not connected yet" }
        let date = Date(timeIntervalSince1970: TimeInterval(device.lastSeenAtUnixMilliseconds) / 1_000)
        return "Seen \(date.formatted(.relative(presentation: .named)))"
    }
}

/// SwiftUI tears down a tracked nested NSMenu when its content view is rebuilt.
/// Runtime health refreshes every two seconds, so keep this subtree stable until
/// the actions that actually shape the menu change.
struct CompanionActionMenu<Actions: View>: View, Equatable {
    let availableUpdate: String?
    let darkAppearance: Bool
    let identity: CompanionActionMenuIdentity
    @ViewBuilder let actions: () -> Actions

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.availableUpdate == rhs.availableUpdate
            && lhs.darkAppearance == rhs.darkAppearance
            && lhs.identity == rhs.identity
    }

    var body: some View {
        Menu(content: actions) {
            Image(systemName: "ellipsis")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(secondaryText)
                .frame(width: 28, height: 28)
                .contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .tint(secondaryText)
        .glassEffect(.regular.interactive(), in: .circle)
        .overlay(alignment: .topTrailing) {
            if availableUpdate != nil {
                Circle().fill(.orange).frame(width: 6, height: 6)
                    .offset(x: -2, y: 2)
                    .allowsHitTesting(false)
            }
        }
        .help("CodeWide actions")
        .accessibilityLabel("CodeWide actions")
        .accessibilityValue(availableUpdate.map { "Update \($0) available" } ?? "")
    }

    private var secondaryText: Color {
        Color(white: darkAppearance ? 0.67 : 0.40)
    }
}

/// Only values that change the action menu's labels, items, enabled state, or
/// behavior belong here. Live connection snapshots intentionally stay out so a
/// periodic status refresh cannot tear down a menu while AppKit is tracking it.
struct CompanionActionMenuIdentity: Equatable {
    struct Profile: Equatable {
        let id: String
        let displayName: String
        let isAvailable: Bool
        let isSelected: Bool
    }

    let appVersion: String?
    let runtimeAvailable: Bool
    let requiresApproval: Bool
    let profiles: [Profile]
    let relayConfigured: Bool
    let relayEnabled: Bool
    let canCheckForUpdates: Bool
    let isCheckingForUpdates: Bool
    let actionInProgress: Bool
    let keepAwakePolicy: String
    let keepAwakeStatus: String

    static let empty = Self(
        appVersion: nil,
        runtimeAvailable: false,
        requiresApproval: false,
        profiles: [],
        relayConfigured: false,
        relayEnabled: false,
        canCheckForUpdates: false,
        isCheckingForUpdates: false,
        actionInProgress: false,
        keepAwakePolicy: "",
        keepAwakeStatus: ""
    )
}
