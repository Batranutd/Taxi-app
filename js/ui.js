// Utilitare comune de interfață.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastBox;
export function toast(text, kind = '', ms = 3200, ic = null) {
  if (!toastBox) { toastBox = h('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(toastBox); }
  const ico = ic || (kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : kind === 'warn' ? 'info' : 'info');
  const el = h(`<div class="toast ${kind}">${icon(ico)}<div>${text}</div></div>`);
  toastBox.append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; setTimeout(() => el.remove(), 320); }, ms);
}

export function modal(html, { onClose, cls = '', locked = false } = {}) {
  const ov = h(`<div class="overlay ${cls}"><div class="panel" role="dialog" aria-modal="true">${html}</div></div>`);
  const close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener('click', e => { if ((e.target === ov && !locked) || e.target.closest('[data-close]')) close(); });
  document.body.append(ov);
  ov.close = close;
  const f = ov.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 60);
  return ov;
}

export function confirmBox(title, text, { yes = 'Da', no = 'Nu', danger = false } = {}) {
  return new Promise(res => {
    const ov = modal(`
      <h2 style="margin:4px 0 8px">${title}</h2>
      <p class="muted" style="margin:0 0 18px">${text}</p>
      <div class="vstack">
        <button class="btn block xl ${danger ? 'danger' : 'dark'}" data-yes>${yes}</button>
        <button class="btn block ghost" data-no>${no}</button>
      </div>`, { onClose: () => res(false) });
    ov.querySelector('[data-yes]').onclick = () => { ov.remove(); res(true); };
    ov.querySelector('[data-no]').onclick = () => { ov.remove(); res(false); };
  });
}

export const fmtTime = t => new Date(t).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
export const fmtMin = sec => {
  const m = Math.max(1, Math.round(sec / 60));
  return m === 1 ? '1 min' : `${m} min`;
};
export const fmtKm = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km`;
export const fmtClock = sec => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
export const fmtMoney = v => (v ?? 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const firstName = n => (n || '').split(' ')[0];

// Sunet scurt (fără fișiere audio)
let ac;
export function beep(pattern = [880, 0.12, 1320, 0.16], vol = 0.18) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    let t = ac.currentTime;
    for (let i = 0; i < pattern.length; i += 2) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = pattern[i];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + pattern[i + 1]);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + pattern[i + 1] + 0.02);
      t += pattern[i + 1] + 0.04;
    }
  } catch { /* fără sunet */ }
}
export function unlockAudio() {
  const f = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {} };
  addEventListener('pointerdown', f, { once: true });
}
export const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ro-RO'; u.rate = 0.95;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ro'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export function applyTextSize(big) { document.documentElement.dataset.text = big ? 'mare' : ''; }
export function applyTheme(dark) { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }

// Linkuri de navigare externă (Waze / Google Maps)
export function navLinks(lat, lon) {
  return {
    waze: `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
  };
}

export function loadingScreen(text = 'Se încarcă harta orașului…') {
  const el = h(`<div class="boot"><div class="boot-logo">${icon('car', { size: 34 })}</div><div>${text}</div></div>`);
  document.body.append(el);
  return { done() { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, fail(msg) { el.innerHTML = `<div class="boot-logo">${icon('alert', { size: 34 })}</div><div>${msg}</div><button class="btn primary" onclick="location.reload()">Încearcă din nou</button>`; } };
}
