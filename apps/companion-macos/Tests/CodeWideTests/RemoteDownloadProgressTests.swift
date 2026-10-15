import Testing
@testable import CodeWide

@Suite("Remote Sparkle download progress")
struct RemoteDownloadProgressTests {
    @Test func reportsAreThrottledButStartAndCompletionAlwaysPublish() {
        let start = ContinuousClock.now
        var progress = RemoteDownloadProgress()
        progress.expect(4_000)
        #expect(progress.report(now: start, force: true)
            == .init(downloadedBytes: 0, totalBytes: 4_000))

        progress.receive(1_000)
        #expect(progress.report(now: start + .milliseconds(200), force: false) == nil)
        #expect(progress.report(now: start + .seconds(1), force: false)
            == .init(downloadedBytes: 1_000, totalBytes: 4_000))

        progress.receive(3_000)
        #expect(progress.report(now: start + .milliseconds(1_100), force: false)
            == .init(downloadedBytes: 4_000, totalBytes: 4_000))
    }

    @Test func unknownLengthReportsBytesOnly() {
        var progress = RemoteDownloadProgress()
        progress.expect(0)
        progress.receive(512)
        #expect(progress.report(now: .now, force: false)
            == .init(downloadedBytes: 512, totalBytes: nil))
    }
}
