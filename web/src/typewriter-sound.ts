export type TypewriterSoundStyle = "classic" | "soft" | "mechanical";

type KeyboardLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  audioContext = new AudioContextCtor();

  // A small master stage makes the synthesized clicks actually audible on
  // ordinary laptop speakers while the compressor keeps rapid typing from
  // stacking into harsh clipping.
  masterGain = audioContext.createGain();
  masterGain.gain.value = 1;

  masterCompressor = audioContext.createDynamicsCompressor();
  masterCompressor.threshold.value = -18;
  masterCompressor.knee.value = 12;
  masterCompressor.ratio.value = 5;
  masterCompressor.attack.value = 0.002;
  masterCompressor.release.value = 0.08;

  masterGain.connect(masterCompressor);
  masterCompressor.connect(audioContext.destination);
  return audioContext;
}

async function ensureAudioReady(): Promise<AudioContext | null> {
  const context = getAudioContext();
  if (!context) return null;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return null;
    }
  }
  return context.state === "running" ? context : null;
}

function outputNode(context: AudioContext): AudioNode {
  return masterGain ?? context.destination;
}

function noiseBuffer(context: AudioContext, duration: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index++) {
    const envelope = 1 - index / frames;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  return buffer;
}

function envelopeGain(context: AudioContext, now: number, peak: number, duration: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(outputNode(context));
  return gain;
}

function playNoise(
  context: AudioContext,
  now: number,
  duration: number,
  peak: number,
  frequency: number,
  q: number,
): void {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency, now);
  filter.Q.setValueAtTime(q, now);
  source.buffer = noiseBuffer(context, duration);
  source.connect(filter);
  filter.connect(envelopeGain(context, now, peak, duration));
  source.start(now);
  source.stop(now + duration + 0.006);
}

function playTone(
  context: AudioContext,
  now: number,
  type: OscillatorType,
  frequency: number,
  duration: number,
  peak: number,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.connect(envelopeGain(context, now, peak, duration));
  oscillator.start(now);
  oscillator.stop(now + duration + 0.006);
}

export function shouldPlayTypewriterSound(event: KeyboardLikeEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length === 1) return true;
  return event.key === "Enter"
    || event.key === "Backspace"
    || event.key === "Delete"
    || event.key === "Tab";
}

export async function playTypewriterSound(style: TypewriterSoundStyle, volume = 85): Promise<void> {
  // Resume must finish before scheduling the sources. Previously the first
  // preview/keypress could schedule into a suspended context and effectively
  // disappear, especially in Electron/Chromium.
  const context = await ensureAudioReady();
  if (!context) return;

  const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
  if (masterGain) {
    // 100% is deliberately punchy on laptop speakers; the compressor below
    // keeps fast typing from becoming a clipping contest.
    masterGain.gain.setTargetAtTime(normalizedVolume * 2.8, context.currentTime, 0.008);
  }
  if (normalizedVolume <= 0) return;

  const now = context.currentTime + 0.004;
  const drift = 0.94 + Math.random() * 0.12;

  if (style === "soft") {
    playNoise(context, now, 0.032, 0.115, 1050 * drift, 0.85);
    playTone(context, now, "sine", 245 * drift, 0.036, 0.060);
    return;
  }

  if (style === "mechanical") {
    playNoise(context, now, 0.052, 0.230, 2450 * drift, 1.35);
    playTone(context, now, "square", 105 * drift, 0.040, 0.140);
    playTone(context, now + 0.004, "triangle", 1850 * drift, 0.030, 0.065);
    return;
  }

  playNoise(context, now, 0.044, 0.185, 1750 * drift, 1.05);
  playTone(context, now, "square", 145 * drift, 0.038, 0.105);
}
