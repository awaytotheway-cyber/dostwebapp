/**
 * Audio and transcript formats at the transcription boundary.
 *
 * Pure: no React Native imports, so it can be tested directly.
 *
 * The bridge hands the pipeline Float32 samples in [-1, 1]. Both
 * transcribers want signed 16-bit little-endian PCM instead: whisper.rn's
 * transcribeData() reads its ArrayBuffer as raw Int16 samples (see
 * decodePcm16 in its RNWhisperJSI.cpp), and the cloud path wants a WAV.
 * Passing a Float32Array's own bytes to whisper makes each sample read as
 * two samples of noise, so it must go through floatToPcm16() first.
 */

/** Float samples in [-1, 1] → little-endian signed 16-bit PCM. */
export function floatToPcm16(pcm: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(pcm.length * 2);
  writePcm16(new DataView(buffer), 0, pcm);
  return buffer;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  writePcm16(view, 44, pcm);
  return buffer;
}

function writePcm16(view: DataView, byteOffset: number, pcm: Float32Array): void {
  for (let i = 0; i < pcm.length; i++) {
    // NaN survives the clamp and is written as 0 by setInt16.
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(byteOffset + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
}

/**
 * Whisper marks non-speech with tags such as [BLANK_AUDIO], [Music] or
 * (wind blowing), and music with ♪. None of them are words the person
 * said: left in, they count towards speaking rate and get sent to be
 * read for feelings.
 */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
