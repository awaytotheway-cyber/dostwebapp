// VAD parity harness, Swift side. Compiled together with the SHIPPING
// ../ios/HearingVAD.swift and ../ios/HearingPCM.swift (the real files,
// not copies). Standard library only. Reads one sample per line on stdin
// and prints one line per event in the same format as the Kotlin
// harness, so the two outputs can be diffed exactly.

func fnv1a(_ s: String) -> UInt64 {
  var h: UInt64 = 0xcbf29ce484222325
  for b in s.utf8 { h ^= UInt64(b); h = h &* 0x100000001b3 }
  return h
}
func bits(_ d: Double) -> String { String(d.bitPattern, radix: 16) }

// Test-only RFC 4648 base64 (standard alphabet, padded, no line breaks):
// the app itself uses Foundation's base64EncodedString, which has the
// same output. What this harness really checks is the byte layout.
func base64(_ bytes: UnsafeBufferPointer<UInt8>) -> String {
  let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)
  var out = [UInt8](); out.reserveCapacity((bytes.count + 2) / 3 * 4)
  var i = 0
  while i + 2 < bytes.count {
    let n = (UInt32(bytes[i]) << 16) | (UInt32(bytes[i + 1]) << 8) | UInt32(bytes[i + 2])
    out += [alphabet[Int(n >> 18)], alphabet[Int((n >> 12) & 63)], alphabet[Int((n >> 6) & 63)], alphabet[Int(n & 63)]]
    i += 3
  }
  let rest = bytes.count - i
  if rest == 1 {
    let n = UInt32(bytes[i]) << 16
    out += [alphabet[Int(n >> 18)], alphabet[Int((n >> 12) & 63)], UInt8(ascii: "="), UInt8(ascii: "=")]
  } else if rest == 2 {
    let n = (UInt32(bytes[i]) << 16) | (UInt32(bytes[i + 1]) << 8)
    out += [alphabet[Int(n >> 18)], alphabet[Int((n >> 12) & 63)], alphabet[Int((n >> 6) & 63)], UInt8(ascii: "=")]
  }
  return String(decoding: out, as: UTF8.self)
}

var pcm = [Int16]()
while let line = readLine() { pcm.append(Int16(line)!) }

let vad = HearingVAD()
var lines: [String] = []
vad.onTick = { t in
  lines.append("T speech=\(t.speech) rms=\(bits(t.rms)) nf=\(bits(t.noiseFloor)) cal=\(t.calibrating) total=\(bits(t.totalMs)) speechMs=\(bits(t.speechMs))")
}
vad.onSegment = { samples, durationMs in
  let bytes = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: samples.count * 2)
  defer { bytes.deallocate() }
  packPCM16LE(samples, into: bytes)
  let b64 = base64(UnsafeBufferPointer(bytes))
  lines.append("S dur=\(durationMs) samples=\(samples.count) b64len=\(b64.utf8.count) b64fnv=\(String(fnv1a(b64), radix: 16))")
}
vad.reset()
pcm.withUnsafeBufferPointer { all in
  var off = 0
  while off + HearingVAD.frameSamples <= all.count {
    vad.process(UnsafeBufferPointer(rebasing: all[off..<(off + HearingVAD.frameSamples)]))
    off += HearingVAD.frameSamples
  }
}
lines.append("E totalFrames=\(vad.totalFrames) speechFrames=\(vad.speechFrames) segments=\(vad.segmentsEmitted)")
print(lines.joined(separator: "\n"))
