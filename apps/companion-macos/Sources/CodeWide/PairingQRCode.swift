import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct PairingQRCode: View {
    let value: String

    var body: some View {
        if let image = makeImage() {
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
        } else {
            ContentUnavailableView("QR unavailable", systemImage: "qrcode")
        }
    }

    private func makeImage() -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: .init(scaleX: 8, y: 8)) else {
            return nil
        }
        let representation = NSCIImageRep(ciImage: output)
        let image = NSImage(size: representation.size)
        image.addRepresentation(representation)
        return image
    }
}
