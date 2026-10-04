export type TypewriterSoundStyle = "classic" | "soft" | "mechanical";

type KeyboardLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

type KeyKind = "character" | "space" | "enter" | "erase" | "tab";

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let cachedNoise: AudioBuffer | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  audioContext = new AudioContextCtor();

  masterGain = audioContext.createGain();
  masterGain.gain.value = 1;

  masterCompressor = audioContext.createDynamicsCompressor();
  // Gentle safety compression only. The old aggressive stage made every
  // synthetic transient pump and ring, which is exactly the "fake" sound.
  masterCompressor.threshold.value = -6;
  masterCompressor.knee.value = 18;
  masterCompressor.ratio.value = 2.2;
  masterCompressor.attack.value = 0.002;
  masterCompressor.release.value = 0.06;

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

function noiseBuffer(context: AudioContext): AudioBuffer {
  if (cachedNoise && cachedNoise.sampleRate === context.sampleRate) return cachedNoise;
  const duration = 0.12;
  const frames = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index++) data[index] = Math.random() * 2 - 1;
  cachedNoise = buffer;
  return buffer;
}

function keyKind(key: string): KeyKind {
  if (key === " ") return "space";
  if (key === "Enter") return "enter";
  if (key === "Backspace" || key === "Delete") return "erase";
  if (key === "Tab") return "tab";
  return "character";
}

function envelope(
  context: AudioContext,
  now: number,
  peak: number,
  attack: number,
  decay: number,
  destination: AudioNode = outputNode(context),
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + Math.max(0.0005, attack));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  gain.connect(destination);
  return gain;
}

function noiseImpact(
  context: AudioContext,
  now: number,
  {
    peak,
    frequency,
    q,
    duration,
    type = "bandpass",
  }: {
    peak: number;
    frequency: number;
    q: number;
    duration: number;
    type?: BiquadFilterType;
  },
): void {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, now);
  filter.Q.setValueAtTime(q, now);
  source.buffer = noiseBuffer(context);
  source.connect(filter);
  filter.connect(envelope(context, now, peak, 0.0008, duration));
  const maxOffset = Math.max(0, source.buffer.duration - duration - 0.002);
  const offset = Math.random() * maxOffset;
  source.start(now, offset, Math.min(source.buffer.duration - offset, duration + 0.004));
}

function keyVariation(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = ((hash * 31) + key.charCodeAt(index)) >>> 0;
  const keyOffset = ((hash % 13) - 6) * 0.0025;
  const humanOffset = (Math.random() - 0.5) * 0.012;
  return 1 + keyOffset + humanOffset;
}

function resonantBody(
  context: AudioContext,
  now: number,
  {
    frequency,
    peak,
    duration,
    type = "sine",
    detune = 0,
  }: {
    frequency: number;
    peak: number;
    duration: number;
    type?: OscillatorType;
    detune?: number;
  },
): void {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.detune.setValueAtTime(detune, now);
  oscillator.connect(envelope(context, now, peak, 0.0008, duration));
  oscillator.start(now);
  oscillator.stop(now + duration + 0.008);
}

function carriageBell(context: AudioContext, now: number, drift: number): void {
  // A carriage-return bell is the only deliberately tonal part. Keep it
  // quiet and short so it reads as hardware in the room, not a UI chime.
  resonantBody(context, now, {
    frequency: 1760 * drift,
    peak: 0.007,
    duration: 0.045,
    type: "sine",
  });
  resonantBody(context, now + 0.001, {
    frequency: 2640 * drift,
    peak: 0.0025,
    duration: 0.032,
    type: "sine",
  });
}

function playClassic(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";
  const isErase = kind === "erase";
  const isTab = kind === "tab";

  // Dry manual typewriter: key travel, typebar/platen impact, tiny return.
  // Noise transients carry the ordinary keys; no pitched oscillator body.
  noiseImpact(context, now, {
    peak: isSpace ? 0.034 : 0.050,
    frequency: (isSpace ? 1250 : 2850) * drift,
    q: isSpace ? 0.62 : 0.92,
    duration: isSpace ? 0.009 : 0.006,
  });

  noiseImpact(context, now + (isSpace ? 0.003 : 0.0035), {
    peak: isSpace ? 0.068 : isEnter ? 0.145 : isErase ? 0.112 : 0.098,
    frequency: (isSpace ? 480 : isEnter ? 720 : isErase ? 1420 : 1080) * drift,
    q: isSpace ? 0.48 : 0.72,
    duration: isEnter ? 0.024 : isSpace ? 0.016 : 0.012,
  });

  noiseImpact(context, now + 0.006, {
    peak: isSpace ? 0.024 : isEnter ? 0.066 : 0.040,
    frequency: (isSpace ? 250 : isEnter ? 300 : 360) * drift,
    q: 0.42,
    duration: isEnter ? 0.030 : 0.020,
    type: "lowpass",
  });

  if (!isSpace) {
    noiseImpact(context, now + (isEnter ? 0.024 : 0.015), {
      peak: isEnter ? 0.030 : isTab ? 0.034 : 0.021,
      frequency: (isErase ? 2200 : 3150) * drift,
      q: 1.05,
      duration: 0.005,
    });
  }

  if (isEnter) carriageBell(context, now + 0.020, drift);
}

function playSoft(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";
  const isErase = kind === "erase";

  // Felted machine: dull key travel plus a restrained platen contact.
  noiseImpact(context, now, {
    peak: isSpace ? 0.022 : 0.036,
    frequency: (isSpace ? 720 : 1180) * drift,
    q: 0.46,
    duration: 0.012,
    type: "lowpass",
  });
  noiseImpact(context, now + 0.004, {
    peak: isSpace ? 0.042 : isEnter ? 0.076 : isErase ? 0.066 : 0.056,
    frequency: (isSpace ? 380 : isEnter ? 520 : 650) * drift,
    q: 0.50,
    duration: isEnter ? 0.024 : 0.016,
    type: "bandpass",
  });
  noiseImpact(context, now + 0.007, {
    peak: isSpace ? 0.014 : 0.024,
    frequency: 270 * drift,
    q: 0.38,
    duration: 0.018,
    type: "lowpass",
  });
}

function playMechanical(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";
  const isErase = kind === "erase";

  // Crisp mechanism: switch click, bottom-out and a much quieter return.
  noiseImpact(context, now, {
    peak: isSpace ? 0.036 : 0.062,
    frequency: (isSpace ? 1700 : 3900) * drift,
    q: 1.20,
    duration: 0.0045,
  });
  noiseImpact(context, now + 0.003, {
    peak: isSpace ? 0.070 : isEnter ? 0.130 : isErase ? 0.118 : 0.100,
    frequency: (isSpace ? 720 : isEnter ? 980 : 1480) * drift,
    q: 0.82,
    duration: isEnter ? 0.017 : 0.010,
  });
  noiseImpact(context, now + (isEnter ? 0.019 : 0.012), {
    peak: isSpace ? 0.016 : 0.026,
    frequency: 3300 * drift,
    q: 1.12,
    duration: 0.004,
  });
  if (isEnter) carriageBell(context, now + 0.017, drift);
}

export function shouldPlayTypewriterSound(event: KeyboardLikeEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length === 1) return true;
  return event.key === "Enter"
    || event.key === "Backspace"
    || event.key === "Delete"
    || event.key === "Tab";
}

export async function playTypewriterSound(
  style: TypewriterSoundStyle,
  volume = 85,
  key = "a",
): Promise<void> {
  const context = await ensureAudioReady();
  if (!context) return;

  const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
  if (normalizedVolume <= 0) return;

  if (masterGain) {
    // A real volume curve: no loudness floor and no >2x gain smashing into
    // the compressor. This preserves the short impact instead of making it honk.
    const amplitude = Math.pow(normalizedVolume, 1.25);
    masterGain.gain.setTargetAtTime(amplitude * 0.92, context.currentTime, 0.008);
  }

  const now = context.currentTime + 0.002;
  const drift = keyVariation(key);
  const kind = keyKind(key);

  if (style === "soft") {
    playSoft(context, now, kind, drift);
    return;
  }
  if (style === "mechanical") {
    playMechanical(context, now, kind, drift);
    return;
  }
  playClassic(context, now, kind, drift);
}
