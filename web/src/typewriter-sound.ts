export type TypewriterSoundStyle = "classic" | "soft" | "mechanical";

type KeyboardLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

type KeyKind = "character" | "space" | "enter" | "erase" | "tab";
type SampleStyle = "classic" | "soft" | "mechanical";

type SampleBank = {
  classic: AudioBuffer;
  soft: AudioBuffer;
  mechanical: AudioBuffer;
  space: AudioBuffer;
  backspace: AudioBuffer;
  carriage: AudioBuffer;
};

type StyleProfile = {
  bank: SampleStyle;
  gain: number;
  rate: number;
  lowpass: number | null;
};

type SpaceProfile = {
  gain: number;
  rate: number;
  highpass: number;
  lowpass: number;
};

const SAMPLE_ASSETS = {
  classic: "/audio/typewriter/classic-keys.mp3",
  soft: "/audio/typewriter/soft-keys.mp3",
  mechanical: "/audio/typewriter/mechanical-keys.mp3",
  space: "/audio/typewriter/space-keys.mp3",
  backspace: "/audio/typewriter/backspace-keys.mp3",
  carriage: "/audio/typewriter/carriage-return.mp3",
} as const;

const SPRITE_SLOT_SECONDS = 0.18;
const SPRITE_CLIP_SECONDS = 0.145;
const SPECIAL_SLOT_SECONDS = 0.12;
const SPECIAL_CLIP_SECONDS = 0.028;

const STYLE_PROFILES: Record<TypewriterSoundStyle, StyleProfile> = {
  // Classic keeps the full body of the supplied manual-typewriter recording.
  classic: { bank: "classic", gain: 0.96, rate: 1.00, lowpass: 7600 },
  // Soft uses the same real mechanism source, slowed and rolled off rather
  // than replacing it with a synthetic thump.
  soft: { bank: "soft", gain: 0.68, rate: 0.92, lowpass: 3600 },
  // Mechanical uses the harder supplied machine recording with its own bank.
  mechanical: { bank: "mechanical", gain: 0.92, rate: 1.035, lowpass: 9200 },
};

// The raw spacebar sample has more cabinet/body resonance than the letter
// impacts. 2.8.2 slowed and low-passed it, exaggerating that resonance into
// an unnatural bassy "thunk". Keep it distinct, but remove the boom and play
// the mechanism slightly faster so it reads as a short spacebar action.
const SPACE_PROFILES: Record<TypewriterSoundStyle, SpaceProfile> = {
  classic: { gain: 0.52, rate: 1.08, highpass: 300, lowpass: 7000 },
  soft: { gain: 0.50, rate: 1.06, highpass: 260, lowpass: 5600 },
  mechanical: { gain: 0.50, rate: 1.10, highpass: 340, lowpass: 8200 },
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let sampleBankPromise: Promise<SampleBank | null> | null = null;
let fallbackNoise: AudioBuffer | null = null;
let variantCursor = 0;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  audioContext = new AudioContextCtor();

  masterGain = audioContext.createGain();
  masterGain.gain.value = 1;

  masterCompressor = audioContext.createDynamicsCompressor();
  masterCompressor.threshold.value = -5;
  masterCompressor.knee.value = 15;
  masterCompressor.ratio.value = 2;
  masterCompressor.attack.value = 0.002;
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

async function loadAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("Typewriter sample failed to load: " + url + " (" + response.status + ")");
  return context.decodeAudioData(await response.arrayBuffer());
}

function ensureSampleBank(context: AudioContext): Promise<SampleBank | null> {
  if (sampleBankPromise) return sampleBankPromise;
  sampleBankPromise = Promise.all([
    loadAudioBuffer(context, SAMPLE_ASSETS.classic),
    loadAudioBuffer(context, SAMPLE_ASSETS.soft),
    loadAudioBuffer(context, SAMPLE_ASSETS.mechanical),
    loadAudioBuffer(context, SAMPLE_ASSETS.space),
    loadAudioBuffer(context, SAMPLE_ASSETS.backspace),
    loadAudioBuffer(context, SAMPLE_ASSETS.carriage),
  ]).then(([classic, soft, mechanical, space, backspace, carriage]) => ({ classic, soft, mechanical, space, backspace, carriage }))
    .catch((error) => {
      console.warn("Folio Typewriter Sound samples unavailable; using safety fallback.", error);
      sampleBankPromise = null;
      return null;
    });
  return sampleBankPromise;
}

export function preloadTypewriterSounds(): void {
  const context = getAudioContext();
  if (context) void ensureSampleBank(context);
}

function keyKind(key: string): KeyKind {
  if (key === " ") return "space";
  if (key === "Enter") return "enter";
  if (key === "Backspace" || key === "Delete") return "erase";
  if (key === "Tab") return "tab";
  return "character";
}

function keyHash(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = ((hash * 31) + key.charCodeAt(index)) >>> 0;
  return hash;
}

function keyVariation(key: string): number {
  const stable = ((keyHash(key) % 11) - 5) * 0.002;
  const human = (Math.random() - 0.5) * 0.012;
  return 1 + stable + human;
}

function nextVariant(key: string): number {
  variantCursor = (variantCursor + 1) % 97;
  return (keyHash(key) + variantCursor) % 3;
}

function keyGain(kind: KeyKind): number {
  if (kind === "space") return 0.55;
  if (kind === "erase") return 0.90;
  if (kind === "tab") return 0.66;
  if (kind === "enter") return 0.82;
  return 1;
}

function playSprite(
  context: AudioContext,
  buffer: AudioBuffer,
  now: number,
  variant: number,
  gainValue: number,
  playbackRate: number,
  lowpass: number | null,
  slotSeconds = SPRITE_SLOT_SECONDS,
  clipSeconds = SPRITE_CLIP_SECONDS,
  highpass: number | null = null,
): void {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(playbackRate, now);
  gain.gain.setValueAtTime(Math.max(0.0001, gainValue), now);
  gain.connect(outputNode(context));

  let current: AudioNode = source;
  if (highpass) {
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(highpass, now);
    filter.Q.setValueAtTime(0.55, now);
    current.connect(filter);
    current = filter;
  }

  if (lowpass) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(lowpass, now);
    filter.Q.setValueAtTime(0.45, now);
    current.connect(filter);
    filter.connect(gain);
  } else {
    current.connect(gain);
  }

  const requestedOffset = variant * slotSeconds;
  const offset = Math.min(requestedOffset, Math.max(0, buffer.duration - 0.018));
  const duration = Math.max(0.018, Math.min(clipSeconds, buffer.duration - offset));
  source.start(now, offset, duration);
}

function playCarriageReturn(context: AudioContext, buffer: AudioBuffer, now: number, style: TypewriterSoundStyle): void {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(style === "soft" ? 0.94 : style === "mechanical" ? 1.03 : 1, now);
  gain.gain.setValueAtTime(style === "soft" ? 0.34 : 0.48, now);
  source.connect(gain);
  gain.connect(outputNode(context));
  source.start(now);
}

function bellEnvelope(context: AudioContext, now: number, peak: number, decay: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  gain.connect(outputNode(context));
  return gain;
}

function playReferenceBell(context: AudioContext, now: number, style: TypewriterSoundStyle): void {
  // Tuned from the supplied real bell reference. Its strongest partials are
  // around 1.79 kHz and 2.86 kHz with a small metallic partial near 5.4 kHz.
  // Keeping those inharmonic partials makes Enter read as a carriage bell
  // instead of the old generic two-sine UI chime.
  const level = style === "soft" ? 0.68 : 1;
  const partials = [
    { frequency: 1787, peak: 0.024 * level, decay: 0.34 },
    { frequency: 2860, peak: 0.060 * level, decay: 0.43 },
    { frequency: 5407, peak: 0.010 * level, decay: 0.18 },
  ];
  for (const partial of partials) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(partial.frequency, now);
    oscillator.detune.setValueAtTime((Math.random() - 0.5) * 5, now);
    oscillator.connect(bellEnvelope(context, now, partial.peak, partial.decay));
    oscillator.start(now);
    oscillator.stop(now + partial.decay + 0.02);
  }
}

function fallbackNoiseBuffer(context: AudioContext): AudioBuffer {
  if (fallbackNoise && fallbackNoise.sampleRate === context.sampleRate) return fallbackNoise;
  const duration = 0.08;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  fallbackNoise = buffer;
  return buffer;
}

function playFallbackClick(context: AudioContext, now: number, kind: KeyKind): void {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = fallbackNoiseBuffer(context);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(kind === "space" ? 1350 : 2400, now);
  filter.Q.setValueAtTime(0.75, now);
  gain.gain.setValueAtTime(kind === "space" ? 0.10 : 0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(outputNode(context));
  source.start(now, Math.random() * 0.03, 0.035);
}

function playSampledKey(
  context: AudioContext,
  bank: SampleBank,
  style: TypewriterSoundStyle,
  key: string,
  now: number,
): void {
  const profile = STYLE_PROFILES[style];
  const kind = keyKind(key);
  const variation = keyVariation(key);

  if (kind === "space") {
    const space = SPACE_PROFILES[style];
    playSprite(
      context,
      bank.space,
      now,
      nextVariant(key),
      profile.gain * space.gain,
      space.rate * variation,
      space.lowpass,
      SPECIAL_SLOT_SECONDS,
      SPECIAL_CLIP_SECONDS,
      space.highpass,
    );
  } else if (kind === "tab") {
    playSprite(
      context,
      bank.space,
      now,
      nextVariant(key),
      profile.gain * 0.50,
      1.03 * variation,
      style === "soft" ? 5200 : 6800,
      SPECIAL_SLOT_SECONDS,
      SPECIAL_CLIP_SECONDS,
      240,
    );
  } else if (kind === "erase") {
    playSprite(
      context,
      bank.backspace,
      now,
      nextVariant(key),
      profile.gain * 0.78,
      profile.rate * variation * 0.98,
      style === "soft" ? 4300 : 7600,
      SPECIAL_SLOT_SECONDS,
      SPECIAL_CLIP_SECONDS,
    );
  } else {
    playSprite(
      context,
      bank[profile.bank],
      now,
      nextVariant(key),
      profile.gain * keyGain(kind),
      profile.rate * variation,
      profile.lowpass,
    );
  }

  if (kind === "enter") {
    playCarriageReturn(context, bank.carriage, now + 0.026, style);
    playReferenceBell(context, now + 0.105, style);
  }
}

function setVolume(context: AudioContext, volume: number): boolean {
  const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
  if (normalizedVolume <= 0) return false;
  if (masterGain) {
    const amplitude = Math.pow(normalizedVolume, 1.18);
    masterGain.gain.setTargetAtTime(amplitude * 0.95, context.currentTime, 0.008);
  }
  return true;
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
  if (!context || !setVolume(context, volume)) return;

  const bank = await ensureSampleBank(context);
  const now = context.currentTime + 0.002;
  if (bank) {
    playSampledKey(context, bank, style, key, now);
    return;
  }

  const kind = keyKind(key);
  playFallbackClick(context, now, kind);
  if (kind === "enter") playReferenceBell(context, now + 0.045, style);
}

export async function playTypewriterPreview(
  style: TypewriterSoundStyle,
  volume = 85,
): Promise<void> {
  const context = await ensureAudioReady();
  if (!context || !setVolume(context, volume)) return;

  const bank = await ensureSampleBank(context);
  const previewKeys = ["F", "o", "l", "i", "o", " ", "Enter"];
  const start = context.currentTime + 0.018;
  previewKeys.forEach((key, index) => {
    const now = start + index * 0.086;
    if (bank) playSampledKey(context, bank, style, key, now);
    else {
      const kind = keyKind(key);
      playFallbackClick(context, now, kind);
      if (kind === "enter") playReferenceBell(context, now + 0.045, style);
    }
  });
}
