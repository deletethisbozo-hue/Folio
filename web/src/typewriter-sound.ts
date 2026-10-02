export type TypewriterSoundStyle = "classic" | "soft" | "mechanical";

type KeyboardLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext = new AudioContextCtor();
  return audioContext;
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
  gain.connect(context.destination);
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
  source.stop(now + duration + 0.005);
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
  oscillator.stop(now + duration + 0.005);
}

export function shouldPlayTypewriterSound(event: KeyboardLikeEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length === 1) return true;
  return event.key === "Enter"
    || event.key === "Backspace"
    || event.key === "Delete"
    || event.key === "Tab";
}

export function playTypewriterSound(style: TypewriterSoundStyle): void {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") void context.resume();
  const now = context.currentTime + 0.001;
  const drift = 0.94 + Math.random() * 0.12;

  if (style === "soft") {
    playNoise(context, now, 0.018, 0.018, 1050 * drift, 0.85);
    playTone(context, now, "sine", 245 * drift, 0.022, 0.012);
    return;
  }

  if (style === "mechanical") {
    playNoise(context, now, 0.036, 0.032, 2450 * drift, 1.35);
    playTone(context, now, "square", 105 * drift, 0.026, 0.021);
    playTone(context, now + 0.004, "triangle", 1850 * drift, 0.018, 0.009);
    return;
  }

  playNoise(context, now, 0.028, 0.026, 1750 * drift, 1.05);
  playTone(context, now, "square", 145 * drift, 0.021, 0.017);
}
