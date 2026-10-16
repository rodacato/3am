let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function buzz(a: AudioContext, at: number, length: number) {
  const osc = a.createOscillator();
  const filter = a.createBiquadFilter();
  const gain = a.createGain();
  osc.type = 'square';
  osc.frequency.value = 96;
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.09, at + 0.03);
  gain.gain.setValueAtTime(0.09, at + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, at + length);
  osc.connect(filter).connect(gain).connect(a.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

// Two buzzes of a phone on wood, then one quiet page tone. Synthesized, so there are no audio assets.
export function playPage(): void {
  const a = audio();
  if (!a) return;
  void a.resume();
  const t0 = a.currentTime + 0.05;
  buzz(a, t0, 0.42);
  buzz(a, t0 + 0.7, 0.42);
  const tone = a.createOscillator();
  const gain = a.createGain();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(880, t0 + 1.4);
  tone.frequency.linearRampToValueAtTime(660, t0 + 1.75);
  gain.gain.setValueAtTime(0, t0 + 1.4);
  gain.gain.linearRampToValueAtTime(0.05, t0 + 1.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
  tone.connect(gain).connect(a.destination);
  tone.start(t0 + 1.4);
  tone.stop(t0 + 2.5);
}
