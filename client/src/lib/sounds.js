let ctx = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!ctx) ctx = new AudioContextClass();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { start = 0, duration = 0.14, type = 'sine', peak = 0.09 } = {}) {
  const audio = getContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const t0 = audio.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playSuccess() {
  tone(660, { start: 0, duration: 0.12 });
  tone(880, { start: 0.08, duration: 0.16 });
}

export function playError() {
  tone(320, { start: 0, duration: 0.16, type: 'triangle', peak: 0.08 });
  tone(220, { start: 0.09, duration: 0.2, type: 'triangle', peak: 0.08 });
}

export function playInfo() {
  tone(520, { start: 0, duration: 0.1, peak: 0.06 });
}
