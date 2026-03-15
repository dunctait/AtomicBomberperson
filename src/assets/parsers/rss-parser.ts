/**
 * RSS sound format parser.
 *
 * Parses Atomic Bomberman raw PCM audio files (no header).
 * Format: 32-bit signed integers (little-endian), 22050 Hz, mono.
 */

export interface ParsedRSS {
  sampleRate: number;  // always 22050
  channels: number;    // always 1
  samples: Float32Array;
}

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 4;
const INT32_MAX = 2147483647;

export function parseRSS(buffer: ArrayBuffer): ParsedRSS {
  const sampleCount = buffer.byteLength / BYTES_PER_SAMPLE;

  if (buffer.byteLength % BYTES_PER_SAMPLE !== 0) {
    throw new Error(
      `RSS file size (${buffer.byteLength} bytes) is not a multiple of ${BYTES_PER_SAMPLE}`,
    );
  }

  const view = new DataView(buffer);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const int32Value = view.getInt32(i * BYTES_PER_SAMPLE, true);
    samples[i] = int32Value / INT32_MAX;
  }

  return {
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    samples,
  };
}

/** Convert parsed RSS to a Web Audio API AudioBuffer. */
export function rssToAudioBuffer(
  parsed: ParsedRSS,
  audioContext: AudioContext,
): AudioBuffer {
  const audioBuffer = audioContext.createBuffer(
    parsed.channels,
    parsed.samples.length,
    parsed.sampleRate,
  );

  audioBuffer.getChannelData(0).set(parsed.samples);

  return audioBuffer;
}
