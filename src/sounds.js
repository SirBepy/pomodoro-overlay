let audioCtx = null;
let _getSettings = null;

export function initSounds(getSettings) {
  _getSettings = getSettings;
}

function getAudioCtx() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function playHoverSound() {
  if (!_getSettings?.()?.sound_enabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.linearRampToValueAtTime(950, t + 0.03);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.04, t + 0.005);
    gain.gain.linearRampToValueAtTime(0, t + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.03);
  } catch (e) {}
}

export function playPressSound() {
  if (!_getSettings?.()?.sound_enabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.055);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  } catch (e) {}
}

export function playReleaseSound() {
  if (!_getSettings?.()?.sound_enabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.linearRampToValueAtTime(720, t + 0.028);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.028);
  } catch (e) {}
}

function synthBeep(volume) {
  try {
    const ctx = getAudioCtx();
    const playTone = (freq, startOffset, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.linearRampToValueAtTime(volume * 0.6, t0 + dur * 0.6);
      gain.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    };
    playTone(880, 0, 0.18);
    playTone(1175, 0.18, 0.32);
  } catch (e) {
    console.warn("synthBeep failed", e);
  }
}

export async function playSound() {
  const settings = _getSettings?.();
  if (!settings?.sound_enabled) return;
  if (settings.sound_path) {
    try {
      const url = window.__TAURI__.core.convertFileSrc(settings.sound_path);
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, settings.volume));
      await audio.play();
      return;
    } catch (e) {
      console.warn("custom sound failed, falling back", e);
    }
  }
  synthBeep(Math.min(1, Math.max(0, settings.volume)));
}
