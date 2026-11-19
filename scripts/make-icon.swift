// Renders Grain's app icon (1024x1024 PNG): a grain seed whose crease is three voice-level
// bars, in paper on a deep green tile. Usage: swift scripts/make-icon.swift out.png
import AppKit
let size = 1024.0
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext
// macOS icon grid: 824pt rounded square centred in 1024.
let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)); ctx.clip()
let rgb = CGColorSpace(name: CGColorSpace.sRGB)!
let grad = CGGradient(colorsSpace: rgb, colors: [CGColor(srgbRed: 0.294, green: 0.416, blue: 0.247, alpha: 1), CGColor(srgbRed: 0.184, green: 0.271, blue: 0.157, alpha: 1)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
// Same geometry as the in-app SVG (viewBox -50..50), scaled to the 824pt tile.
ctx.translateBy(x: 512, y: 512); ctx.scaleBy(x: 8.24, y: 8.24)
let seed = CGMutablePath()
seed.move(to: CGPoint(x: 0, y: 30))
seed.addCurve(to: CGPoint(x: 0, y: -30), control1: CGPoint(x: 18, y: 12), control2: CGPoint(x: 18, y: -12))
seed.addCurve(to: CGPoint(x: 0, y: 30), control1: CGPoint(x: -18, y: -12), control2: CGPoint(x: -18, y: 12))
// Bars are holes (even-odd), so the tile's gradient shows through them.
for (x, h) in [(-7.0, 5.0), (0.0, 12.0), (7.0, 7.0)] {
    seed.addPath(CGPath(roundedRect: CGRect(x: x - 1.8, y: -h - 1.8, width: 3.6, height: 2 * h + 3.6), cornerWidth: 1.8, cornerHeight: 1.8, transform: nil))
}
ctx.addPath(seed)
ctx.setFillColor(CGColor(srgbRed: 0.957, green: 0.937, blue: 0.894, alpha: 1))
ctx.fillPath(using: .evenOdd)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
