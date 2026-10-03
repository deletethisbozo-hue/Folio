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
  masterCompressor.threshold.value = -14;
  masterCompressor.knee.value = 10;
  masterCompressor.ratio.value = 4;
  masterCompressor.attack.value = 0.0015;
  masterCompressor.release.value = 0.075;

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

function metalPing(context: AudioContext, now: number, peak: number, frequency: number, duration: number): void {
  const bus = context.createGain();
  bus.gain.value = 1;
  bus.connect(outputNode(context));
  resonantBody(context, now, { frequency, peak, duration, type: "sine" });
  resonantBody(context, now + 0.0015, { frequency: frequency * 1.47, peak: peak * 0.33, duration: duration * 0.72, type: "sine", detune: 5 });
}

function playClassic(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";
  const isErase = kind === "erase";
  const isTab = kind === "tab";

  // Manual typewriter: keycap movement -> typebar/platen strike -> case resonance -> key return.
  noiseImpact(context, now, {
    peak: isSpace ? 0.055 : 0.105,
    frequency: (isSpace ? 1050 : 2350) * drift,
    q: isSpace ? 0.72 : 1.2,
    duration: isSpace ? 0.014 : 0.010,
  });

  noiseImpact(context, now + (isSpace ? 0.004 : 0.0055), {
    peak: isSpace ? 0.115 : isEnter ? 0.205 : isErase ? 0.175 : 0.155,
    frequency: (isSpace ? 520 : isEnter ? 980 : 1320) * drift,
    q: isSpace ? 0.58 : 0.9,
    duration: isEnter ? 0.032 : 0.022,
  });

  resonantBody(context, now + 0.006, {
    frequency: (isSpace ? 118 : isEnter ? 142 : 176) * drift,
    peak: isSpace ? 0.052 : isEnter ? 0.11 : 0.072,
    duration: isEnter ? 0.055 : 0.036,
    type: "triangle",
  });

  if (!isSpace) {
    noiseImpact(context, now + (isEnter ? 0.026 : 0.020), {
      peak: isEnter ? 0.070 : 0.045,
      frequency: (isErase ? 2100 : 3150) * drift,
      q: 1.45,
      duration: 0.008,
    });
  }

  if (isEnter) {
    metalPing(context, now + 0.018, 0.026, 1320 * drift, 0.075);
  } else if (isTab) {
    resonantBody(context, now + 0.010, {
      frequency: 510 * drift,
      peak: 0.032,
      duration: 0.028,
      type: "triangle",
    });
  }
}

function playSoft(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";

  // Felted/quiet machine: rounded key travel and a muted platen impact.
  noiseImpact(context, now, {
    peak: isSpace ? 0.035 : 0.060,
    frequency: (isSpace ? 620 : 1080) * drift,
    q: 0.55,
    duration: 0.018,
    type: "lowpass",
  });

  noiseImpact(context, now + 0.005, {
    peak: isSpace ? 0.060 : isEnter ? 0.095 : 0.078,
    frequency: (isSpace ? 390 : 720) * drift,
    q: 0.62,
    duration: isEnter ? 0.030 : 0.020,
    type: "bandpass",
  });

  resonantBody(context, now + 0.006, {
    frequency: (isSpace ? 92 : isEnter ? 122 : 148) * drift,
    peak: isSpace ? 0.030 : isEnter ? 0.054 : 0.040,
    duration: isEnter ? 0.045 : 0.030,
    type: "sine",
  });
}

function playMechanical(context: AudioContext, now: number, kind: KeyKind, drift: number): void {
  const isSpace = kind === "space";
  const isEnter = kind === "enter";
  const isErase = kind === "erase";

  // Hard mechanical switch/typebar feel: switch click, bottom-out and return.
  noiseImpact(context, now, {
    peak: isSpace ? 0.060 : 0.125,
    frequency: (isSpace ? 1450 : 3600) * drift,
    q: 1.55,
    duration: 0.007,
  });

  resonantBody(context, now + 0.0025, {
    frequency: (isSpace ? 185 : isEnter ? 225 : 255) * drift,
    peak: isSpace ? 0.050 : isEnter ? 0.095 : 0.068,
    duration: isEnter ? 0.034 : 0.022,
    type: "triangle",
  });

  noiseImpact(context, now + 0.006, {
    peak: isSpace ? 0.105 : isEnter ? 0.185 : isErase ? 0.165 : 0.145,
    frequency: (isSpace ? 760 : 1650) * drift,
    q: 1.02,
    duration: isEnter ? 0.024 : 0.014,
  });

  noiseImpact(context, now + (isEnter ? 0.028 : 0.019), {
    peak: isSpace ? 0.040 : 0.072,
    frequency: 4200 * drift,
    q: 1.8,
    duration: 0.006,
  });

  if (isEnter) metalPing(context, now + 0.016, 0.018, 1560 * drift, 0.055);
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
    // Keep 100% clearly audible without relying on square-wave loudness.
    masterGain.gain.setTargetAtTime(0.18 + normalizedVolume * 1.85, context.currentTime, 0.006);
  }

  const now = context.currentTime + 0.003;
  const drift = 0.965 + Math.random() * 0.07;
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
