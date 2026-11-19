// grain-capture: Grain's macOS audio capture helper.
//
// Runs as a Tauri sidecar so that capture is isolated from the UI and inference:
// if the app crashes, everything already written to disk survives.
//
// Subcommands (all print JSON on stdout):
//   devices                      list microphones
//   permissions                  microphone + screen-capture (system audio) status
//   request-mic                  prompt for microphone access
//   request-screen               prompt for screen & system audio access
//   record --out DIR [--mic UID|default|none] [--system] [--duration SEC]
//
// `record` writes DIR/mic.pcm and DIR/system.pcm: raw 16 kHz mono s16le, appended
// and fsync'd every second, so a crash loses at most ~1 s. Both tracks share one
// timeline (wall clock minus paused time); gaps (e.g. silence where ScreenCaptureKit
// delivers nothing, or a device switch) are padded with zeros to keep them aligned.
// stdin commands: pause | resume | stop | mic <UID|default>. EOF on stdin = stop.

import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

let sampleRate = 16000.0

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func now() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e9 }

// MARK: - Shared recording clock

final class Clock {
    private let lock = NSLock()
    private var start: Double = 0
    private var pausedTotal: Double = 0
    private var pauseStart: Double?

    func begin() { lock.lock(); start = now(); lock.unlock() }
    var paused: Bool { lock.lock(); defer { lock.unlock() }; return pauseStart != nil }
    func pause() { lock.lock(); if pauseStart == nil { pauseStart = now() }; lock.unlock() }
    func resume() {
        lock.lock()
        if let p = pauseStart { pausedTotal += now() - p; pauseStart = nil }
        lock.unlock()
    }
    /// Seconds of recorded (non-paused) time so far.
    var elapsed: Double {
        lock.lock(); defer { lock.unlock() }
        let end = pauseStart ?? now()
        return max(0, end - start - pausedTotal)
    }
}

// MARK: - Track writer (one per source)

final class Track {
    let name: String
    private let handle: FileHandle
    private let lock = NSLock()
    private(set) var written: Int = 0  // samples
    private var peak: Float = 0
    private var lastSync = now()
    private let clock: Clock

    init(name: String, path: URL, clock: Clock) throws {
        self.name = name
        self.clock = clock
        if !FileManager.default.fileExists(atPath: path.path) {
            FileManager.default.createFile(atPath: path.path, contents: nil)
        }
        handle = try FileHandle(forWritingTo: path)
        let end = try handle.seekToEnd()
        written = Int(end / 2)
    }

    /// Append 16 kHz mono Int16 samples captured "just now".
    func append(_ samples: [Int16]) {
        if clock.paused || samples.isEmpty { return }
        lock.lock(); defer { lock.unlock() }
        // Keep the track aligned with the shared timeline: if the source went quiet
        // (no buffers delivered), pad the gap with silence before writing.
        let expectedEnd = Int(clock.elapsed * sampleRate)
        let gap = expectedEnd - samples.count - written
        if gap > Int(0.25 * sampleRate) { writeLocked([Int16](repeating: 0, count: gap)) }
        writeLocked(samples)
        var p: Float = 0
        for s in samples { p = max(p, abs(Float(s)) / 32768) }
        peak = max(peak, p)
    }

    /// Pad to the shared timeline (called on stop and periodically so silent tracks stay aligned).
    func padToNow() {
        if clock.paused { return }
        lock.lock(); defer { lock.unlock() }
        let gap = Int(clock.elapsed * sampleRate) - written
        if gap > Int(0.5 * sampleRate) { writeLocked([Int16](repeating: 0, count: gap)) }
    }

    private func writeLocked(_ samples: [Int16]) {
        samples.withUnsafeBufferPointer { handle.write(Data(buffer: $0)) }
        written += samples.count
        if now() - lastSync > 1 { try? handle.synchronize(); lastSync = now() }
    }

    func takePeak() -> Float { lock.lock(); defer { lock.unlock() }; let p = peak; peak = 0; return p }

    func close() { lock.lock(); try? handle.synchronize(); try? handle.close(); lock.unlock() }
}

// MARK: - Format conversion (any PCM CMSampleBuffer -> 16 kHz mono Int16)

final class Converter {
    private var converter: AVAudioConverter?
    private var inFormat: AVAudioFormat?
    private let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true)!

    func convert(_ sb: CMSampleBuffer) -> [Int16] {
        guard let fd = CMSampleBufferGetFormatDescription(sb),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fd) else { return [] }
        var asbd = asbdPtr.pointee
        if inFormat == nil || !sameFormat(inFormat!.streamDescription.pointee, asbd) {
            guard let f = AVAudioFormat(streamDescription: &asbd) else { return [] }
            inFormat = f
            converter = AVAudioConverter(from: f, to: outFormat)
            converter?.downmix = true
        }
        guard let inFormat, let converter else { return [] }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
        guard frames > 0, let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: frames) else { return [] }
        inBuf.frameLength = frames
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(frames), into: inBuf.mutableAudioBufferList) == noErr else { return [] }
        let cap = AVAudioFrameCount(Double(frames) * sampleRate / inFormat.sampleRate) + 64
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return [] }
        var fed = false
        var err: NSError?
        converter.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return inBuf
        }
        if err != nil { return [] }
        let n = Int(outBuf.frameLength)
        return Array(UnsafeBufferPointer(start: outBuf.int16ChannelData![0], count: n))
    }

    private func sameFormat(_ a: AudioStreamBasicDescription, _ b: AudioStreamBasicDescription) -> Bool {
        a.mSampleRate == b.mSampleRate && a.mFormatID == b.mFormatID && a.mFormatFlags == b.mFormatFlags
            && a.mChannelsPerFrame == b.mChannelsPerFrame && a.mBitsPerChannel == b.mBitsPerChannel
    }
}

// MARK: - Microphone (AVCaptureSession)

final class MicCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    let track: Track
    let converter = Converter()
    let queue = DispatchQueue(label: "grain.mic")
    private(set) var deviceName = ""
    private var deviceUID = ""

    init(track: Track) { self.track = track }

    static func find(_ uid: String) -> AVCaptureDevice? {
        if uid == "default" || uid.isEmpty { return AVCaptureDevice.default(for: .audio) }
        return AVCaptureDevice(uniqueID: uid) ?? AVCaptureDevice.default(for: .audio)
    }

    func start(uid: String) throws {
        guard let device = MicCapture.find(uid) else { throw NSError(domain: "grain", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone found"]) }
        let input = try AVCaptureDeviceInput(device: device)
        session.beginConfiguration()
        for i in session.inputs { session.removeInput(i) }
        guard session.canAddInput(input) else { session.commitConfiguration(); throw NSError(domain: "grain", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot use microphone \(device.localizedName)"]) }
        session.addInput(input)
        if session.outputs.isEmpty {
            let out = AVCaptureAudioDataOutput()
            out.setSampleBufferDelegate(self, queue: queue)
            session.addOutput(out)
        }
        session.commitConfiguration()
        deviceName = device.localizedName
        deviceUID = device.uniqueID
        if !session.isRunning { session.startRunning() }
        NotificationCenter.default.addObserver(self, selector: #selector(disconnected(_:)), name: AVCaptureDevice.wasDisconnectedNotification, object: device)
    }

    @objc func disconnected(_ note: Notification) {
        emit(["event": "device_lost", "source": "mic", "device": deviceName])
        do {
            try start(uid: "default")
            emit(["event": "device_changed", "source": "mic", "device": deviceName, "uid": deviceUID])
        } catch {
            emit(["event": "error", "source": "mic", "message": error.localizedDescription])
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        track.append(converter.convert(sb))
    }

    func stop() { session.stopRunning() }
}

// MARK: - System audio (ScreenCaptureKit)

@available(macOS 13.0, *)
final class SystemCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    let track: Track
    let converter = Converter()
    var stream: SCStream?
    let queue = DispatchQueue(label: "grain.system")

    init(track: Track) { self.track = track }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw NSError(domain: "grain", code: 3, userInfo: [NSLocalizedDescriptionKey: "No display available for system audio capture"]) }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        // We only want audio; keep the mandatory video stream as cheap as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let s = SCStream(filter: filter, configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid else { return }
        track.append(converter.convert(sb))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["event": "error", "source": "system", "message": error.localizedDescription])
    }

    func stop() async { try? await stream?.stopCapture() }
}

// MARK: - Control channel

final class Control: @unchecked Sendable {
    var started = false
    var mic: MicCapture?
    func handle(_ cmd: String, clock: Clock) {
        if cmd == "pause" { clock.pause(); emit(["event": "paused"]) }
        else if cmd == "resume" { clock.resume(); emit(["event": "resumed"]) }
        else if cmd.hasPrefix("mic "), let m = mic {
            let uid = String(cmd.dropFirst(4))
            m.queue.async {
                do { try m.start(uid: uid); emit(["event": "device_changed", "source": "mic", "device": m.deviceName]) }
                catch { emit(["event": "error", "source": "mic", "message": error.localizedDescription]) }
            }
        }
    }
}

struct TimeoutError: LocalizedError { var errorDescription: String? { "System audio did not start in time" } }

func withTimeout(seconds: Double, _ op: @escaping @Sendable () async throws -> Void) async throws {
    try await withThrowingTaskGroup(of: Void.self) { g in
        g.addTask { try await op() }
        g.addTask { try await Task.sleep(nanoseconds: UInt64(seconds * 1e9)); throw TimeoutError() }
        try await g.next()
        g.cancelAll()
    }
}

// MARK: - Commands

func permissions() -> [String: Any] {
    let mic: String
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: mic = "granted"
    case .denied: mic = "denied"
    case .restricted: mic = "restricted"
    default: mic = "not_determined"
    }
    return ["mic": mic, "screen": CGPreflightScreenCaptureAccess() ? "granted" : "not_granted"]
}

func devices() -> [[String: Any]] {
    let types: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) { types = [.microphone, .external] } else { types = [.builtInMicrophone, .externalUnknown] }
    let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .audio, position: .unspecified).devices
    let def = AVCaptureDevice.default(for: .audio)?.uniqueID
    return found.map { ["uid": $0.uniqueID, "name": $0.localizedName, "default": $0.uniqueID == def] }
}

func arg(_ name: String, _ args: [String]) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func record(_ args: [String]) async -> Int32 {
    guard let out = arg("--out", args) else { emit(["event": "error", "message": "--out required"]); return 2 }
    let dir = URL(fileURLWithPath: out, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let micUID = arg("--mic", args) ?? "default"
    let wantSystem = args.contains("--system")
    let duration = arg("--duration", args).flatMap(Double.init)

    let clock = Clock()
    clock.begin()

    // Control channel first: even if a source blocks while starting (e.g. a pending
    // permission prompt), closing stdin or the parent dying must stop the helper.
    let done = DispatchSemaphore(value: 0)
    let control = Control()
    Thread.detachNewThread {
        while let line = readLine() {
            let cmd = line.trimmingCharacters(in: .whitespaces)
            if cmd == "stop" { break }
            control.handle(cmd, clock: clock)
        }
        if !control.started { exit(0) }
        done.signal()
    }
    let parent = getppid()
    DispatchQueue.global().async {
        while true {
            sleep(1)
            if getppid() != parent { if !control.started { exit(0) }; done.signal(); return }
        }
    }
    var tracks: [Track] = []
    var mic: MicCapture?
    var system: AnyObject?

    if micUID != "none" {
        do {
            let t = try Track(name: "mic", path: dir.appendingPathComponent("mic.pcm"), clock: clock)
            let m = MicCapture(track: t)
            try m.start(uid: micUID)
            mic = m; tracks.append(t)
        } catch { emit(["event": "error", "source": "mic", "message": error.localizedDescription]) }
    }
    if wantSystem, #available(macOS 13.0, *) {
        if !CGPreflightScreenCaptureAccess() {
            // Never block on a permission prompt mid-meeting: report and continue with the mic.
            emit(["event": "error", "source": "system", "code": "permission", "message": "Screen & System Audio Recording permission is not granted"])
        } else {
            do {
                let t = try Track(name: "system", path: dir.appendingPathComponent("system.pcm"), clock: clock)
                let s = SystemCapture(track: t)
                try await withTimeout(seconds: 10) { try await s.start() }
                system = s; tracks.append(t)
            } catch { emit(["event": "error", "source": "system", "message": error.localizedDescription]) }
        }
    }
    if tracks.isEmpty { emit(["event": "error", "message": "No audio source could be started"]); return 1 }
    control.mic = mic
    control.started = true
    emit(["event": "started", "mic": mic != nil, "system": system != nil, "micDevice": mic?.deviceName ?? ""])

    // Levels + keep silent tracks aligned, 10x per second.
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "grain.levels"))
    timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
    var ticks = 0
    timer.setEventHandler {
        var e: [String: Any] = ["event": "level", "elapsed": clock.elapsed, "paused": clock.paused]
        for t in tracks { e[t.name] = t.takePeak() }
        emit(e)
        ticks += 1
        if ticks % 10 == 0 { tracks.forEach { $0.padToNow() } }
    }
    timer.resume()

    if let duration {
        DispatchQueue.global().asyncAfter(deadline: .now() + duration) { done.signal() }
    }
    await withCheckedContinuation { c in DispatchQueue.global().async { done.wait(); c.resume() } }

    timer.cancel()
    mic?.stop()
    if #available(macOS 13.0, *), let s = system as? SystemCapture { await s.stop() }
    if clock.paused { clock.resume() }
    var result: [String: Any] = ["event": "stopped", "elapsed": clock.elapsed]
    for t in tracks { t.padToNow(); result[t.name + "Samples"] = t.written; t.close() }
    emit(result)
    return 0
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "devices":
    emit(["devices": devices()])
case "permissions":
    emit(permissions())
case "request-mic":
    let sem = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in sem.signal() }
    sem.wait()
    emit(permissions())
case "request-screen":
    _ = CGRequestScreenCaptureAccess()
    emit(permissions())
case "record":
    let sem = DispatchSemaphore(value: 0)
    var code: Int32 = 0
    Task { code = await record(args); sem.signal() }
    sem.wait()
    exit(code)
default:
    FileHandle.standardError.write("usage: grain-capture devices|permissions|request-mic|request-screen|record --out DIR [--mic UID|default|none] [--system] [--duration SEC]\n".data(using: .utf8)!)
    exit(2)
}
