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

// Avatar: poză (dacă există) sau inițiale
export function avatar(name, photo, size = 48) {
  const ini = (name || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${photo ? `<img src="${photo}" alt="">` : esc(ini)}</span>`;
}

// Alege o poză și o micșorează (128 px), ca să circule ușor între aplicații
export function pickPhoto() {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return res(null);
      const img = new Image();
      img.onload = () => {
        const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
        const k = Math.max(s / img.width, s / img.height), w = img.width * k, h = img.height * k;
        c.getContext('2d').drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
        res(c.toDataURL('image/jpeg', 0.82));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}

// „Glisează ca să comanzi”: previne comenzile din greșeală
export function swipeHtml(label = 'Glisează ca să comanzi') {
  return `<div class="swipe" role="group" aria-label="${esc(label)}"><div class="fill"></div><div class="lbl">${esc(label)}<span class="ar">${icon('chevron', { size: 20 })}${icon('chevron', { size: 20 })}</span></div><button class="knob" type="button" aria-label="${esc(label)} – apasă Enter">${icon('car', { size: 30 })}</button></div>`;
}
export function bindSwipe(root, onDone, doneLabel = 'Se trimite comanda…') {
  const sw = root.classList && root.classList.contains('swipe') ? root : root.querySelector('.swipe');
  if (!sw) return;
  const knob = sw.querySelector('.knob'), fill = sw.querySelector('.fill');
  let x0 = null, dx = 0, max = 0, moved = false, fired = false;
  const set = v => { knob.style.transform = `translateX(${v}px)`; fill.style.width = (72 + v) + 'px'; };
  const finish = () => {
    if (fired) return; fired = true;
    set(max); sw.classList.add('done'); sw.querySelector('.lbl').textContent = doneLabel;
    vibrate(60); setTimeout(onDone, 180);
  };
  knob.addEventListener('pointerdown', e => { if (fired) return; x0 = e.clientX; max = sw.clientWidth - 72; moved = false; knob.setPointerCapture(e.pointerId); knob.style.transition = fill.style.transition = 'none'; });
  knob.addEventListener('pointermove', e => { if (x0 === null) return; dx = Math.max(0, Math.min(max, e.clientX - x0)); if (dx > 6) moved = true; set(dx); });
  const up = () => {
    if (x0 === null) return; x0 = null;
    knob.style.transition = fill.style.transition = 'transform .25s ease, width .25s ease';
    if (dx >= max * 0.82) finish();
    else { set(0); if (!moved) { sw.classList.remove('shake'); void sw.offsetWidth; sw.classList.add('shake'); toast('Trage mașinuța spre dreapta până la capăt', '', 2200, 'chevron'); } }
    dx = 0;
  };
  knob.addEventListener('pointerup', up); knob.addEventListener('pointercancel', up);
  knob.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); max = sw.clientWidth - 72; finish(); } });
}
