import CodeWideShared
import Foundation

extension Guardian {
    /// Completes the recoverable side effects after the durable commit point.
    /// It is safe to call after every guardian restart until all writes land.
    func finishCommit(
        journal: HostUpdateJournalPayload,
        context: GuardianOperationContext
    ) throws -> HostUpdateOperationPayload {
        var state = try storage.loadState()
        let installation = try storage.installation()
        let app = URL(fileURLWithPath: installation.canonicalAppPath, isDirectory: true)
        try system.verifyCodeSignature(app: app)
        let metadata = try system.metadata(app: app)
        let treeDigest = try storage.bundleTreeDigest(app)
        let identityDigest = try storage.bundleTreeDigest(
            RuntimeConstants.stateDirectory.appending(path: "identity", directoryHint: .isDirectory)
        )
        let devicesDigest = try storage.deviceRegistryIdentityDigest(
            RuntimeConstants.stateDirectory.appending(path: "devices.json")
        )
        guard metadata.version == context.target.version,
              metadata.build == context.target.build,
              metadata.sourceRevision == context.target.sourceRevision,
              treeDigest == context.targetBundleTreeDigest,
              identityDigest == context.identityTreeDigest,
              devicesDigest == context.deviceRegistryDigest else {
            throw GuardianFailure.internalError("committed_target_verification_failed")
        }

        let sequence: UInt64
        if let available = state.available,
           available.targetFingerprint == context.targetFingerprint {
            sequence = available.releaseSequence
        } else if let receipt = state.receipt,
                  receipt.currentDigest == context.target.sha256,
                  receipt.currentVersion == context.target.version,
                  receipt.currentBuild == context.target.build,
                  receipt.currentSourceRevision == context.target.sourceRevision,
                  receipt.bundleTreeDigest == treeDigest {
            sequence = receipt.highestSequence
        } else {
            throw GuardianFailure.internalError("committed_target_receipt_missing")
        }
        let receipt = GuardianBootstrapReceipt(
            schemaVersion: HostUpdateIPC.bootstrapVersion,
            currentVersion: metadata.version,
            currentBuild: metadata.build,
            currentSourceRevision: metadata.sourceRevision,
            currentDigest: context.target.sha256,
            highestSequence: sequence,
            stateEpoch: context.target.stateEpoch,
            bundleTreeDigest: treeDigest
        )
        state.receipt = receipt
        try storage.saveState(state)
        try storage.publishCapability(receipt)
        let result = operation(journal: journal, context: context)
        try storage.saveTerminal(result)
        state.available = nil
        try storage.saveState(state)
        if let snapshotPath = context.snapshotPath {
            try storage.discardSnapshot(URL(fileURLWithPath: snapshotPath))
        }
        try? FileManager.default.removeItem(
            at: storage.appCommandURL(operationID: journal.operationId)
        )
        return result
    }
}
