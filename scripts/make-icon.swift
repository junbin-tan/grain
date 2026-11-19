// Renders Grain's app icon (1024x1024 PNG): one grain seed in paper on a flat accent-green tile;
// the seed's crease doubles as a single voice-level bar. Usage: swift scripts/make-icon.swift out.png
import AppKit
let size = 1024.0
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext
// macOS icon grid: 824pt rounded square centred in 1024.
let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)); ctx.clip()
// Tile = `accent` (#3f5a36), seed = `paper` (#fbfaf7) from src/styles.css.
ctx.setFillColor(CGColor(srgbRed: 0x3f / 255.0, green: 0x5a / 255.0, blue: 0x36 / 255.0, alpha: 1))
ctx.fill(rect)
// Same geometry as the in-app SVG (viewBox -50..50), scaled to the 824pt tile.
ctx.translateBy(x: 512, y: 512); ctx.scaleBy(x: 8.24, y: 8.24)
let seed = CGMutablePath()
seed.move(to: CGPoint(x: 0, y: 30))
seed.addCurve(to: CGPoint(x: 0, y: -30), control1: CGPoint(x: 19, y: 12), control2: CGPoint(x: 19, y: -12))
seed.addCurve(to: CGPoint(x: 0, y: 30), control1: CGPoint(x: -19, y: -12), control2: CGPoint(x: -19, y: 12))
// The crease is a hole (even-odd), so the tile shows through it.
seed.addPath(CGPath(roundedRect: CGRect(x: -2.2, y: -17.2, width: 4.4, height: 34.4), cornerWidth: 2.2, cornerHeight: 2.2, transform: nil))
ctx.addPath(seed)
ctx.setFillColor(CGColor(srgbRed: 0xfb / 255.0, green: 0xfa / 255.0, blue: 0xf7 / 255.0, alpha: 1))
ctx.fillPath(using: .evenOdd)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
