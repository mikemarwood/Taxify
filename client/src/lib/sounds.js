// Short synthesised UI sounds. Nothing is loaded over the network — every
// sound here is a couple of oscillator tones, so there's no audio asset to
// ship and no delay before the first one plays.
//
// Muting is handled in one place, because an app that beeps at you with no
// way to stop it is worse than one that stays quiet.

const MUTE_KEY = 'taxify:sound';

let ctx = null;
let enabled = readPreference();

function readPreference() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(MUTE_KEY) !== 'off';
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(next) {
  enabled = !!next;
  try {
    localStorage.setItem(MUTE_KEY, enabled ? 'on' : 'off');
  } catch {
    // private mode — the setting just won't survive a reload
  }
  if (enabled) playClick();
}

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!ctx) ctx = new AudioContextClass();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { start = 0, duration = 0.14, type = 'sine', peak = 0.09, endFreq = null } = {}) {
  if (!enabled) return;
  const audio = getContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const t0 = audio.currentTime + start;
  // A glide reads as one gesture rather than two notes — used for the
  // open/close pair so they feel like the same movement reversed.
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playSuccess() {
  tone(660, { start: 0, duration: 0.11, peak: 0.07 });
  tone(880, { start: 0.07, duration: 0.15, peak: 0.07 });
}

export function playError() {
  tone(320, { start: 0, duration: 0.16, type: 'triangle', peak: 0.07 });
  tone(220, { start: 0.09, duration: 0.2, type: 'triangle', peak: 0.07 });
}

export function playInfo() {
  tone(520, { start: 0, duration: 0.1, peak: 0.05 });
}

// A dry tick for ordinary clicks — short enough to sit under a rapid series
// of them without turning into a drone.
export function playClick() {
  tone(1400, { start: 0, duration: 0.03, type: 'sine', peak: 0.03 });
}

export function playOpen() {
  tone(420, { start: 0, duration: 0.13, peak: 0.045, endFreq: 720 });
}

export function playClose() {
  tone(720, { start: 0, duration: 0.11, peak: 0.04, endFreq: 420 });
}

export function playKeypadBeep() {
  tone(1050, { start: 0, duration: 0.045, type: 'square', peak: 0.04 });
}

// The real thing: a telephone keypad tone.
//
// DTMF is two sine waves at once — one for the row, one for the column — and
// that pair is why a dialled number sounds like a dialled number rather than
// like a beep. Entering a code that arrived by text is the one place in this
// app where somebody is doing something that genuinely is dialling, so it is
// worth being the actual sound and not an impression of one.
//
// Quiet and short. This fires four times in two seconds on a phone that may be
// held to somebody's face.
const DTMF_ROW = [697, 770, 852, 941];
const DTMF_COL = [1209, 1336, 1477];
const DTMF_GRID = {
  1: [0, 0], 2: [0, 1], 3: [0, 2],
  4: [1, 0], 5: [1, 1], 6: [1, 2],
  7: [2, 0], 8: [2, 1], 9: [2, 2],
  '*': [3, 0], 0: [3, 1], '#': [3, 2],
};

export function playDialTone(key) {
  const cell = DTMF_GRID[key];
  if (!cell) return;
  const options = { start: 0, duration: 0.09, peak: 0.035 };
  tone(DTMF_ROW[cell[0]], options);
  tone(DTMF_COL[cell[1]], options);
}

// Attach as onKeyDown on a code field. Only the digits: a backspace that
// dialled would be telling somebody they had entered something.
export function onDialpadKeyDown(e) {
  if (/^[0-9]$/.test(e.key)) playDialTone(e.key);
}

// Attach as onKeyDown on a numeric input to get a soft ATM-style beep per
// digit. The decimal point counts: it is part of typing an amount, and a key
// that stays silent in the middle of a number reads as one that didn't
// register. Comma too — that is what the numeric keypad reports on a lot of
// non-UK layouts.
export function onDigitKeyDown(e) {
  if (/^[0-9.,]$/.test(e.key)) playKeypadBeep();
}
