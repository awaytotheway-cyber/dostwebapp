import Foundation

// The byte layout itself is in HearingPCM.swift (standard library only,
// tested against Android in ../ios-tests/). This file adds the
// Foundation parts: base64 and wall-clock time.

/// Pack Int16 samples as little-endian bytes and base64 them — the exact
/// wire format HearingService.kt and EnrollmentRecorder.kt emit, which
/// lib/hearing/hearingBridge.ts decodes.
func pcm16Base64(_ samples: UnsafeBufferPointer<Int16>) -> String {
  var data = Data(count: samples.count * 2)
  data.withUnsafeMutableBytes { raw in
    packPCM16LE(samples, into: raw.bindMemory(to: UInt8.self))
  }
  let encoded = data.base64EncodedString()
  // The byte copy held audio too.
  data.resetBytes(in: 0..<data.count)
  return encoded
}

func nowMs() -> Double {
  Date().timeIntervalSince1970 * 1000
}
