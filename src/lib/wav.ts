// Small audio helpers shared by the browser (recording) and the server (wrapping synthesized speech).

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return out;
}

// Average-based downsampling: cheap, and the averaging acts as a low-pass filter against aliasing.
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = a; j < b; j++) sum += input[j];
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

export function rms(f: Float32Array): number {
  let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return f.length ? Math.sqrt(s / f.length) : 0;
}

// 16-bit mono PCM -> a playable/uploadable WAV file.
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export function int16ToBytes(s: Int16Array): Uint8Array {
  const b = new Uint8Array(s.length * 2); const v = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) v.setInt16(i * 2, s[i], true);
  return b;
}
