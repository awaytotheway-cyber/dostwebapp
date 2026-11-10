/// Pack Int16 samples as little-endian bytes: the wire format that
/// HearingService.kt and EnrollmentRecorder.kt emit (ByteBuffer,
/// LITTLE_ENDIAN) and lib/hearing/hearingBridge.ts decodes. Get a byte
/// order wrong here and every segment decodes as noise.
///
/// Swift standard library only, like HearingVAD.swift, so the parity
/// check in ../ios-tests/ compares these exact bytes against Android's.
///
/// Writes into caller-owned memory rather than returning an array, so the
/// caller decides when the copy is zeroed.
func packPCM16LE(_ samples: UnsafeBufferPointer<Int16>, into bytes: UnsafeMutableBufferPointer<UInt8>) {
  precondition(bytes.count >= samples.count * 2, "byte buffer too small")
  for i in 0..<samples.count {
    let v = UInt16(bitPattern: samples[i])
    bytes[2 * i] = UInt8(truncatingIfNeeded: v)
    bytes[2 * i + 1] = UInt8(truncatingIfNeeded: v >> 8)
  }
}
