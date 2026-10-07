// Desktop run of the phone's clip logic (plugins/listening/kotlin/ClipAssembler.kt).
// Reads 16 kHz mono PCM16 little-endian, feeds 32 ms frames through
// ClipAssembler exactly as the service does, and prints the clips and
// counters as JSON. Time is "milliseconds since the start of the file".
//
//   kotlinc ClipAssemblerSim.kt ../../../plugins/listening/kotlin/{ListenConfig,EnergyGate,PcmRing,ClipAssembler}.kt \
//       -include-runtime -d sim.jar
//   java -cp sim.jar ClipAssemblerSimKt input.pcm > clips.json

import com.dost.app.listening.ClipAssembler
import com.dost.app.listening.ClipOutput
import com.dost.app.listening.ClipWriter
import com.dost.app.listening.ListenConfig
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

private class MemoryClip(val startMs: Long) : ClipWriter {
  var samples = 0L
  override val durationMs: Long get() = samples * 1000 / ListenConfig.SAMPLE_RATE
  override fun write(pcm: ShortArray, offset: Int, len: Int) { samples += len }
  override fun finish(): Long = samples * 2
  override fun abort() {}
}

fun main(args: Array<String>) {
  val bytes = File(args[0]).readBytes()
  val shorts = ShortArray(bytes.size / 2)
  ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)

  val clips = mutableListOf<Pair<Long, Long>>()
  val events = mutableListOf<String>()
  val asm = ClipAssembler(0, object : ClipOutput {
    override fun open(startEpochMs: Long): ClipWriter = MemoryClip(startEpochMs)
    override fun saved(writer: ClipWriter, startEpochMs: Long, sizeBytes: Long) {
      clips += startEpochMs to writer.durationMs
    }
    override fun event(type: String, fields: Map<String, Any?>) { events += type }
  })

  val n = ListenConfig.FRAME_SAMPLES
  val frame = ShortArray(n)
  var pos = 0
  while (pos + n <= shorts.size) {
    System.arraycopy(shorts, pos, frame, 0, n)
    pos += n
    asm.process(frame, n, pos * 1000L / ListenConfig.SAMPLE_RATE)
  }
  asm.closeClip()

  val sr = ListenConfig.SAMPLE_RATE
  println("{")
  println("  \"listenedMs\": ${asm.listenedSamples * 1000 / sr},")
  println("  \"savedMs\": ${asm.savedSamples * 1000 / sr},")
  println("  \"tooShortMs\": ${asm.tooShortSamples * 1000 / sr},")
  println("  \"silencedMs\": ${asm.silencedSamples * 1000 / sr},")
  println("  \"events\": [${events.joinToString(",") { "\"$it\"" }}],")
  println("  \"clips\": [${clips.joinToString(",") { "[${it.first},${it.second}]" }}]")
  println("}")
}
