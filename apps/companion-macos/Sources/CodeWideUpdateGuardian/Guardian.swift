import CodeWideShared
import CompanionSwiftFFI
import CryptoKit
import Foundation

enum GuardianManifestURLs {
    static func latest(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        #if CODEWIDE_E2E_NAMESPACE
        try e2eBase(environment: environment).appending(
            path: "latest/release-manifest.json"
        )
        #else
        URL(
            string: "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json"
        )!
        #endif
    }

    static func baseline(
        version: String,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        #if CODEWIDE_E2E_NAMESPACE
        try e2eBase(environment: environment).appending(
            path: "releases/download/v\(version)/release-manifest.json"
        )
        #else
        URL(
            string: "https://github.com/MrFlashAccount/CodeWide/releases/download/v\(version)/release-manifest.json"
        )!
        #endif
    }

    #if CODEWIDE_E2E_NAMESPACE
    private static func e2eBase(environment: [String: String]) throws -> URL {
        guard let base = RuntimeConstants.validatedE2EManifestBaseURL(
            environment[RuntimeConstants.e2eManifestBaseEnvironmentName]
        ) else {
            throw GuardianFailure.manual("e2e_manifest_base_invalid")
        }
        return base
    }
    #endif
}

actor Guardian {
    let storage: GuardianStorage
    let system: GuardianSystem
    private let now: @Sendable () -> UInt64
    private let stateEpoch: UInt32 = 1

    init(
        root: URL,
        fileManager: FileManager = .default,
        now: @escaping @Sendable () -> UInt64 = {
            UInt64(Date().timeIntervalSince1970 * 1_000)
        }
    ) throws {
        storage = try GuardianStorage(root: root, fileManager: fileManager)
        system = GuardianSystem(fileManager: fileManager, updaterRoot: root)
        self.now = now
    }

    func serve() async {
        while !Task.isCancelled {
            do {
                try await processRequests()
                try await reconcile()
            } catch {
                FileHandle.standardError.write(Data("CodeWideUpdateGuardian: \(error)\n".utf8))
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    private func processRequests() async throws {
        for url in try storage.pendingRequests() {
            let request: GuardianIPCRequest
            do {
                request = try storage.consumeRequest(url)
            } catch {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            guard storage.isSafeIdentifier(request.requestId),
                  request.requestId == url.deletingPathExtension().lastPathComponent else {
                continue
            }
            guard request.supportsV1 else {
                try respond(request, failure: .manual("unsupported_guardian_contract"))
                continue
            }
            do {
                switch request.method {
                case "status":
                    try storage.writeIPCResponse(
                        GuardianIPCResponse(requestId: request.requestId, payload: try status())
                    )
                case "check":
                    try storage.writeIPCResponse(
                        GuardianIPCResponse(requestId: request.requestId, payload: try await check())
                    )
                case "apply":
                    guard let command = request.command else {
                        throw GuardianFailure.invalid("missing_apply_command")
                    }
                    let accepted = try apply(command)
                    try storage.writeIPCResponse(
                        GuardianIPCResponse(requestId: request.requestId, payload: accepted)
                    )
                case "operation":
                    guard let operationID = request.operationId else {
                        throw GuardianFailure.invalid("missing_operation_id")
                    }
                    try storage.writeIPCResponse(
                        GuardianIPCResponse(
                            requestId: request.requestId,
                            payload: try operation(operationID)
                        )
                    )
                case "reconnect":
                    guard let receipt = request.receipt else {
                        throw GuardianFailure.invalid("missing_reconnect_receipt")
                    }
                    try storage.writeIPCResponse(
                        GuardianIPCResponse(
                            requestId: request.requestId,
                            payload: try reconnect(receipt)
                        )
                    )
                default:
                    throw GuardianFailure.invalid("unsupported_guardian_method")
                }
            } catch let failure as GuardianFailure {
                try respond(request, failure: failure)
            } catch {
                try respond(request, failure: .internalError(error.localizedDescription))
            }
        }
    }

    private func respond(_ request: GuardianIPCRequest, failure: GuardianFailure) throws {
        try storage.writeIPCResponse(
            GuardianIPCResponse<EmptyGuardianPayload>(requestId: request.requestId, error: failure.ipc)
        )
    }

    private func status() throws -> HostUpdateStatusPayload {
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        let metadata = try system.metadata(app: app)
        let state = try storage.loadState()
        let published = try storage.publishedCapability()
        let validReceipt: GuardianBootstrapReceipt?
        if let receipt = state.receipt,
           let published,
           receipt.currentVersion == metadata.version,
           receipt.currentBuild == metadata.build,
           receipt.currentSourceRevision == metadata.sourceRevision,
           receipt.currentDigest == published.currentDigest,
           receipt.bundleTreeDigest == published.bundleTreeDigest,
           receipt.stateEpoch == published.stateEpoch {
            validReceipt = receipt
        } else {
            validReceipt = nil
            try storage.revokeCapability()
        }
        let operation: HostUpdateOperationPayload?
        if let journal = try storage.loadJournal() {
            operation = try self.operation(journal.operationId)
        } else {
            operation = nil
        }
        return HostUpdateStatusPayload(
            currentVersion: metadata.version,
            currentBuild: metadata.build,
            currentSourceRevision: metadata.sourceRevision,
            currentDigest: validReceipt?.currentDigest ?? String(repeating: "0", count: 64),
            capability: validReceipt == nil
                ? .disabled("manual_bootstrap_required")
                : .enabled(),
            availableTarget: validReceipt == nil ? nil : state.available,
            activeOperation: operation
        )
    }

    private func check() async throws -> HostUpdateStatusPayload {
        var state = try storage.loadState()
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        try storage.probeAtomicSiblingRename(canonicalApp: app)
        let metadata = try system.metadata(app: app)
        let receipt = try await establishOrVerifyReceipt(
            existing: state.receipt,
            app: app,
            metadata: metadata
        )
        let trust = try storage.trust()
        let manifest = try await downloadManifest(try GuardianManifestURLs.latest())
        let admitted = try admitMacosHostUpdateRelease(
            envelopeJson: manifest,
            publicKeySpki: trust.publicKeySPKI,
            nowUnixSeconds: now() / 1_000,
            trustedKeyId: trust.keyId,
            currentVersion: receipt.currentVersion,
            currentDigest: receipt.currentDigest,
            highestSequence: receipt.highestSequence,
            stateEpoch: receipt.stateEpoch
        )
        let target = payload(admitted.target)
        state.receipt = receipt
        state.available = AvailableHostUpdatePayload(
            target: target,
            targetFingerprint: admitted.targetFingerprint,
            releaseSequence: admitted.sequence,
            expiresAt: admitted.expiresAt
        )
        try storage.saveState(state)
        try storage.publishCapability(receipt)
        return try status()
    }

    private func establishOrVerifyReceipt(
        existing: GuardianBootstrapReceipt?,
        app: URL,
        metadata: InstalledAppMetadata
    ) async throws -> GuardianBootstrapReceipt {
        let treeDigest = try storage.bundleTreeDigest(app)
        do {
            try system.verifyCodeSignature(app: app)
        } catch {
            try storage.revokeCapability()
            throw GuardianFailure.manual("installed_signature_changed_after_check")
        }
        if let existing,
           existing.currentVersion == metadata.version,
           existing.currentBuild == metadata.build,
           existing.currentSourceRevision == metadata.sourceRevision,
           existing.bundleTreeDigest == treeDigest,
           existing.stateEpoch == stateEpoch {
            return existing
        }
        let trust = try storage.trust()
        let manifestURL = try GuardianManifestURLs.baseline(version: metadata.version)
        let manifest = try await downloadManifest(manifestURL)
        let verified = try verifyHostUpdateRelease(
            envelopeJson: manifest,
            publicKeySpki: trust.publicKeySPKI,
            nowUnixSeconds: now() / 1_000,
            trustedKeyId: trust.keyId
        )
        guard let ffiTarget = verified.targets.first(where: {
            $0.platform == "macos-universal" && $0.version == metadata.version
                && $0.build == metadata.build && $0.sourceRevision == metadata.sourceRevision
        }) else {
            throw GuardianFailure.manual("baseline_release_metadata_mismatch")
        }
        let target = payload(ffiTarget)
        guard target.stateEpoch == stateEpoch,
              target.bootstrapVersion == HostUpdateIPC.bootstrapVersion,
              target.journalVersion == HostUpdateIPC.journalVersion else {
            throw GuardianFailure.manual("baseline_guardian_contract_mismatch")
        }
        let image = storage.root.appending(path: "v1/baseline-\(UUID().uuidString).dmg")
        defer { try? FileManager.default.removeItem(at: image) }
        guard let baselineArtifactURL = URL(string: target.artifactUrl) else {
            throw GuardianFailure.manual("baseline_artifact_url_invalid")
        }
        try await system.download(baselineArtifactURL, to: image)
        guard try sha256(image) == target.sha256 else {
            throw GuardianFailure.manual("baseline_artifact_digest_mismatch")
        }
        let mountedDigest = try system.withMountedApplication(dmg: image) { mounted in
            try system.verifyCodeSignature(app: mounted)
            guard try system.metadata(app: mounted) == metadata else {
                throw GuardianFailure.manual("baseline_mounted_metadata_mismatch")
            }
            return try storage.bundleTreeDigest(mounted)
        }
        guard mountedDigest == treeDigest else {
            throw GuardianFailure.manual("baseline_installed_bundle_mismatch")
        }
        let receipt = GuardianBootstrapReceipt(
            schemaVersion: HostUpdateIPC.bootstrapVersion,
            currentVersion: metadata.version,
            currentBuild: metadata.build,
            currentSourceRevision: metadata.sourceRevision,
            currentDigest: target.sha256,
            highestSequence: verified.sequence,
            stateEpoch: target.stateEpoch,
            bundleTreeDigest: treeDigest
        )
        var state = try storage.loadState()
        state.receipt = receipt
        try storage.saveState(state)
        return receipt
    }

    private func apply(_ command: ApplyHostUpdateCommandPayload) throws
        -> ApplyHostUpdateAcceptedPayload
    {
        guard !command.idempotencyKey.isEmpty, !command.initiatingDeviceId.isEmpty else {
            throw GuardianFailure.invalid("invalid_apply_identity")
        }
        var state = try storage.loadState()
        if let operationID = state.idempotency[command.idempotencyKey] {
            let existing = try operation(operationID)
            guard existing.targetFingerprint == command.targetFingerprint else {
                throw GuardianFailure.idempotency("idempotency_key_reused")
            }
            return ApplyHostUpdateAcceptedPayload(
                operationId: existing.operationId,
                phase: existing.phase
            )
        }
        if let journal = try storage.loadJournal(),
           let context = try? storage.loadContext(),
           context.idempotencyKey == command.idempotencyKey,
           context.appCommand.operationId == journal.operationId {
            guard context.targetFingerprint == command.targetFingerprint else {
                throw GuardianFailure.idempotency("idempotency_key_reused")
            }
            // Recover the narrow crash window after the accepted journal fsync
            // but before the lookup index fsync/HTTP response.
            let existing = try operation(journal.operationId)
            guard existing.targetFingerprint == command.targetFingerprint else {
                throw GuardianFailure.idempotency("idempotency_key_reused")
            }
            state.idempotency[command.idempotencyKey] = journal.operationId
            try storage.saveState(state)
            return ApplyHostUpdateAcceptedPayload(
                operationId: existing.operationId,
                phase: existing.phase
            )
        }
        if let active = try storage.loadJournal(), !terminal(active.phase) {
            throw GuardianFailure.locked("another_update_is_active")
        }
        guard let receipt = state.receipt,
              let available = state.available,
              available.targetFingerprint == command.targetFingerprint,
              now() / 1_000 <= available.expiresAt,
              available.target.stateEpoch == receipt.stateEpoch,
              available.target.rollbackCompatibleFrom.contains(receipt.currentDigest) else {
            throw GuardianFailure.precondition("target_not_checked_or_changed")
        }
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        let installedMetadata = try system.metadata(app: app)
        guard installedMetadata.version == receipt.currentVersion,
              installedMetadata.build == receipt.currentBuild,
              installedMetadata.sourceRevision == receipt.currentSourceRevision,
              try storage.bundleTreeDigest(app) == receipt.bundleTreeDigest else {
            try storage.revokeCapability()
            throw GuardianFailure.manual("installed_bundle_changed_after_check")
        }
        do {
            try system.verifyCodeSignature(app: app)
        } catch {
            try storage.revokeCapability()
            throw GuardianFailure.manual("installed_signature_changed_after_check")
        }
        try storage.probeAtomicSiblingRename(canonicalApp: app)
        let observedAt = now()
        let observation = try system.runtimeObservation(now: observedAt)
        guard observation.appVersion == receipt.currentVersion, observation.upstreamLive else {
            throw GuardianFailure.precondition("runtime_or_upstream_not_ready")
        }
        let operationID = UUID().uuidString.lowercased()
        let nonce = UUID().uuidString.lowercased()
        let identityDigest = try storage.bundleTreeDigest(
            RuntimeConstants.stateDirectory.appending(path: "identity", directoryHint: .isDirectory)
        )
        let devicesDigest = try storage.deviceRegistryIdentityDigest(
            RuntimeConstants.stateDirectory.appending(path: "devices.json")
        )
        let commandForApp = GuardianAppCommand(
            operationId: operationID,
            nonce: nonce,
            target: available.target,
            canonicalAppPath: app.path
        )
        let context = GuardianOperationContext(
            currentVersion: receipt.currentVersion,
            target: available.target,
            targetFingerprint: available.targetFingerprint,
            idempotencyKey: command.idempotencyKey,
            appCommand: commandForApp,
            snapshotPath: nil,
            targetBundleTreeDigest: nil,
            identityTreeDigest: identityDigest,
            deviceRegistryDigest: devicesDigest
        )
        let deadlines = HostUpdateDeadlinesPayload(
            installBy: observedAt + 10 * 60_000,
            targetReadyBy: observedAt + 15 * 60_000,
            reconnectBy: observedAt + 20 * 60_000,
            rollbackBy: observedAt + 25 * 60_000
        )
        let journal = HostUpdateJournalPayload(
            journalVersion: HostUpdateIPC.journalVersion,
            operationId: operationID,
            nonce: nonce,
            initiatingDeviceId: command.initiatingDeviceId,
            currentDigest: receipt.currentDigest,
            targetDigest: available.target.sha256,
            targetFingerprint: available.targetFingerprint,
            preUpdateRelay: HostUpdateRelayStatePayload(
                configured: observation.relayConfigured,
                enabled: observation.relayEnabled,
                upstreamLive: observation.relayEnabled && observation.relayLive
            ),
            deadlines: deadlines,
            phase: "accepted",
            startedAt: observedAt,
            restartStartedAt: nil,
            updatedAt: observedAt,
            errorCode: nil,
            errorMessage: nil
        )
        // Context first, journal second: an accepted journal is always fully
        // recoverable. The HTTP proxy sees success only after both fsyncs.
        try storage.saveContext(context)
        try storage.saveJournal(journal)
        state.idempotency[command.idempotencyKey] = operationID
        try storage.saveState(state)
        return ApplyHostUpdateAcceptedPayload(operationId: operationID, phase: "accepted")
    }

    private func operation(_ operationID: String) throws -> HostUpdateOperationPayload {
        if let terminal = try storage.loadTerminal(operationID) { return terminal }
        guard let journal = try storage.loadJournal(), journal.operationId == operationID else {
            throw GuardianFailure.notFound
        }
        let context = try storage.loadContext()
        return operation(journal: journal, context: context)
    }

    private func reconnect(_ receipt: ReconnectReceiptPayload) throws -> HostUpdateOperationPayload {
        guard var journal = try storage.loadJournal(), journal.operationId == receipt.operationId else {
            throw GuardianFailure.notFound
        }
        guard journal.phase == "awaitingReconnect" else {
            throw GuardianFailure.conflict("operation_not_awaiting_reconnect")
        }
        guard receipt.deviceId == journal.initiatingDeviceId else {
            throw GuardianFailure.precondition("reconnect_wrong_device")
        }
        let observedAt = now()
        guard let restart = journal.restartStartedAt,
              observedAt > restart, observedAt <= journal.deadlines.reconnectBy else {
            throw GuardianFailure.precondition("reconnect_not_fresh")
        }
        let context = try storage.loadContext()
        try verifyTarget(context: context, journal: journal)
        // `committed` is the single irreversible decision. Everything after
        // this fsync is idempotent finalization, so a guardian crash can never
        // leave an awaiting operation with the previous receipt overwritten.
        journal.phase = "committed"
        journal.updatedAt = observedAt
        try storage.saveJournal(journal)
        return try finishCommit(journal: journal, context: context)
    }

    private func reconcile() async throws {
        guard var journal = try storage.loadJournal() else { return }
        var context = try storage.loadContext()
        if journal.phase == "committed" {
            _ = try finishCommit(journal: journal, context: context)
            return
        }
        guard !terminal(journal.phase) else { return }
        let currentTime = now()
        if journal.phase == "accepted" {
            do {
                guard currentTime <= journal.deadlines.installBy else {
                    throw GuardianFailure.precondition("install_start_timeout")
                }
                let installation = try storage.installation()
                let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
                let snapshot = try storage.createSnapshot(
                    canonicalApp: app,
                    operationID: journal.operationId
                )
                context.snapshotPath = snapshot.path
                try storage.saveContext(context)
                let image = storage.root.appending(path: "v1/target-\(journal.operationId).dmg")
                defer { try? FileManager.default.removeItem(at: image) }
                guard let artifactURL = URL(string: context.target.artifactUrl) else {
                    throw GuardianFailure.precondition("target_artifact_url_invalid")
                }
                try await system.download(artifactURL, to: image)
                guard try sha256(image) == context.target.sha256 else {
                    throw GuardianFailure.precondition("target_artifact_digest_mismatch")
                }
                let targetTree = try system.withMountedApplication(dmg: image) { mounted in
                    try system.verifyCodeSignature(app: mounted)
                    let metadata = try system.metadata(app: mounted)
                    guard metadata.version == context.target.version,
                          metadata.build == context.target.build,
                          metadata.sourceRevision == context.target.sourceRevision else {
                        throw GuardianFailure.precondition("target_bundle_metadata_mismatch")
                    }
                    return try storage.bundleTreeDigest(mounted)
                }
                guard now() <= journal.deadlines.installBy else {
                    throw GuardianFailure.precondition("install_start_timeout")
                }
                context.targetBundleTreeDigest = targetTree
                try storage.saveContext(context)
                try storage.writeAppCommand(context.appCommand)
                journal.phase = "installing"
                journal.updatedAt = now()
                try storage.saveJournal(journal)
                try await system.launch(app: app)
            } catch let failure as GuardianFailure {
                if context.snapshotPath != nil {
                    try await rollback(&journal, context: &context, reason: failure.ipc.message)
                } else {
                    journal.phase = "failed"
                    journal.updatedAt = now()
                    journal.errorCode = failure.ipc.code
                    journal.errorMessage = failure.ipc.message
                    try storage.saveJournal(journal)
                    try storage.saveTerminal(operation(journal: journal, context: context))
                }
            } catch {
                if context.snapshotPath != nil {
                    try await rollback(
                        &journal,
                        context: &context,
                        reason: "install_preparation_failed: \(error.localizedDescription)"
                    )
                } else {
                    journal.phase = "failed"
                    journal.updatedAt = now()
                    journal.errorCode = "update_internal_error"
                    journal.errorMessage = error.localizedDescription
                    try storage.saveJournal(journal)
                    try storage.saveTerminal(operation(journal: journal, context: context))
                }
            }
            return
        }
        if journal.phase == "installing" {
            if let event = try storage.consumeAppEvent(operationID: journal.operationId) {
                guard event.operationId == journal.operationId, event.nonce == journal.nonce,
                      event.targetVersion == context.target.version else { return }
                switch event.kind {
                case "installing":
                    journal.restartStartedAt = currentTime
                    journal.updatedAt = currentTime
                    try storage.saveJournal(journal)
                case "failed":
                    try await rollback(&journal, context: &context, reason: event.errorMessage ?? "sparkle_failed")
                case "targetReady":
                    do {
                        try verifyTarget(context: context, journal: journal)
                        journal.phase = "targetReady"
                        journal.updatedAt = currentTime
                        try storage.saveJournal(journal)
                        journal.phase = "awaitingReconnect"
                        journal.updatedAt = currentTime
                        try storage.saveJournal(journal)
                    } catch {
                        try await rollback(
                            &journal,
                            context: &context,
                            reason: "target_readiness_verification_failed"
                        )
                    }
                default:
                    break
                }
            }
            if currentTime > journal.deadlines.targetReadyBy {
                try await rollback(&journal, context: &context, reason: "target_ready_timeout")
            }
            return
        }
        if journal.phase == "targetReady" {
            journal.phase = "awaitingReconnect"
            journal.updatedAt = currentTime
            try storage.saveJournal(journal)
            return
        }
        if journal.phase == "awaitingReconnect", currentTime > journal.deadlines.reconnectBy {
            try await rollback(&journal, context: &context, reason: "reconnect_timeout")
        } else if journal.phase == "rollingBack" {
            do {
                try await finishRollback(&journal, context: &context)
            } catch {
                journal.updatedAt = now()
                journal.errorCode = "rollback_retry_failed"
                journal.errorMessage = error.localizedDescription
                try storage.saveJournal(journal)
            }
        }
    }

    private func verifyTarget(
        context: GuardianOperationContext,
        journal: HostUpdateJournalPayload
    ) throws {
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        try system.verifyCodeSignature(app: app)
        let metadata = try system.metadata(app: app)
        let appDigest = try storage.bundleTreeDigest(app)
        let identityDigest = try storage.bundleTreeDigest(
            RuntimeConstants.stateDirectory.appending(path: "identity", directoryHint: .isDirectory)
        )
        let devicesDigest = try storage.deviceRegistryIdentityDigest(
            RuntimeConstants.stateDirectory.appending(path: "devices.json")
        )
        guard metadata.version == context.target.version,
              metadata.build == context.target.build,
              metadata.sourceRevision == context.target.sourceRevision,
              appDigest == context.targetBundleTreeDigest,
              identityDigest == context.identityTreeDigest,
              devicesDigest == context.deviceRegistryDigest else {
            throw GuardianFailure.precondition("target_readiness_identity_mismatch")
        }
        let observation = try system.runtimeObservation(now: now())
        guard observation.appVersion == context.target.version,
              observation.coreRunning, observation.upstreamLive,
              !journal.preUpdateRelay.upstreamLive || observation.relayLive else {
            throw GuardianFailure.precondition("target_runtime_not_ready")
        }
    }

    private func rollback(
        _ journal: inout HostUpdateJournalPayload,
        context: inout GuardianOperationContext,
        reason: String
    ) async throws {
        guard journal.phase != "rollingBack" else {
            try await finishRollback(&journal, context: &context)
            return
        }
        journal.phase = "rollingBack"
        journal.updatedAt = now()
        journal.errorCode = "update_rolled_back"
        journal.errorMessage = reason
        try storage.saveJournal(journal)
        try await finishRollback(&journal, context: &context)
    }

    private func finishRollback(
        _ journal: inout HostUpdateJournalPayload,
        context: inout GuardianOperationContext
    ) async throws {
        guard let snapshotPath = context.snapshotPath else {
            throw GuardianFailure.internalError("rollback_snapshot_missing")
        }
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        // Login/crash recovery must still be able to roll back after the
        // original SLA expired. Bound each retry instead of making expiry a
        // permanent inability to restore the snapshot.
        let retryDeadline = Date().addingTimeInterval(30)
        try system.fenceForRollback(
            app: app,
            deadline: retryDeadline
        )
        let snapshot = URL(fileURLWithPath: snapshotPath, isDirectory: true)
        if FileManager.default.fileExists(atPath: snapshot.path) {
            if (try? verifyRestoredBundle(app: app, context: context)) == nil {
                try storage.restoreSnapshot(
                    snapshot: snapshot,
                    canonicalApp: app
                )
            }
            context.rollbackRestoredAt = now()
            try storage.saveContext(context)
        }
        try verifyRestoredBundle(app: app, context: context)
        try storage.discardSnapshot(snapshot)
        try await system.launch(app: app)
        try system.reRegisterRuntime(app: app)
        try await waitForRestoredRuntime(app: app, journal: journal, context: context)
        journal.phase = "rolledBack"
        journal.updatedAt = now()
        try storage.saveJournal(journal)
        let result = operation(journal: journal, context: context)
        try storage.saveTerminal(result)
        try? FileManager.default.removeItem(at: storage.appCommandURL(operationID: journal.operationId))
    }

    private func verifyRestoredBundle(
        app: URL,
        context: GuardianOperationContext
    ) throws {
        guard let receipt = try storage.loadState().receipt,
              receipt.currentVersion == context.currentVersion else {
            throw GuardianFailure.internalError("rollback_receipt_missing")
        }
        try system.verifyCodeSignature(app: app)
        let metadata = try system.metadata(app: app)
        guard metadata.version == receipt.currentVersion,
              metadata.build == receipt.currentBuild,
              metadata.sourceRevision == receipt.currentSourceRevision,
              try storage.bundleTreeDigest(app) == receipt.bundleTreeDigest,
              try storage.bundleTreeDigest(
                  RuntimeConstants.stateDirectory.appending(path: "identity", directoryHint: .isDirectory)
              ) == context.identityTreeDigest,
              try storage.deviceRegistryIdentityDigest(
                  RuntimeConstants.stateDirectory.appending(path: "devices.json")
              )
                == context.deviceRegistryDigest else {
            throw GuardianFailure.internalError("rollback_verification_failed")
        }
    }

    private func waitForRestoredRuntime(
        app: URL,
        journal: HostUpdateJournalPayload,
        context: GuardianOperationContext
    ) async throws {
        let retryDeadline = max(journal.deadlines.rollbackBy, now() + 60_000)
        while now() <= retryDeadline {
            do {
                try verifyRestoredBundle(app: app, context: context)
                let observation = try system.runtimeObservation(now: now())
                if observation.appVersion == context.currentVersion,
                   observation.coreRunning,
                   observation.upstreamLive,
                   !journal.preUpdateRelay.upstreamLive || observation.relayLive {
                    return
                }
            } catch {
                // Runtime observation is expected to be stale during relaunch.
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw GuardianFailure.internalError("rollback_readiness_timeout")
    }

    func operation(
        journal: HostUpdateJournalPayload,
        context: GuardianOperationContext
    ) -> HostUpdateOperationPayload {
        HostUpdateOperationPayload(
            operationId: journal.operationId,
            phase: journal.phase,
            currentVersion: context.currentVersion,
            targetVersion: context.target.version,
            targetFingerprint: context.targetFingerprint,
            startedAt: journal.startedAt,
            updatedAt: journal.updatedAt,
            errorCode: journal.errorCode,
            errorMessage: journal.errorMessage
        )
    }

    private func terminal(_ phase: String) -> Bool {
        phase == "committed" || phase == "rolledBack" || phase == "failed"
    }

    private func downloadManifest(_ url: URL) async throws -> String {
        let destination = storage.root.appending(path: "v1/manifest-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: destination) }
        try await system.download(url, to: destination)
        let data = try Data(contentsOf: destination)
        guard data.count <= 1024 * 1024, let value = String(data: data, encoding: .utf8) else {
            throw GuardianFailure.precondition("release_manifest_invalid")
        }
        return value
    }

    private func payload(_ target: FfiHostUpdateTarget) -> ReleaseTargetPayload {
        ReleaseTargetPayload(
            platform: target.platform,
            version: target.version,
            build: target.build,
            sourceRevision: target.sourceRevision,
            artifactUrl: target.artifactUrl,
            sha256: target.sha256,
            bootstrapVersion: target.bootstrapVersion,
            journalVersion: target.journalVersion,
            stateEpoch: target.stateEpoch,
            rollbackCompatibleFrom: target.rollbackCompatibleFrom
        )
    }

    func sha256(_ url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
