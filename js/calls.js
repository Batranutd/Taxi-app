// Apeluri prin centrală între client, șofer și dispecerat (numerele rămân ascunse).
// În demo, sunetul e simulat; în producție se folosește un furnizor de telefonie (ex. Twilio).
import { icon } from './icons.js';
import { esc, beep, vibrate, fmtClock, toast } from './ui.js';
import { initials } from './sim.js';

export function mountCalls(bus, me, { label = p => p.name || 'Apel', photo = () => null } = {}) {
  const box = document.createElement('div');
  box.className = 'call-ov';
  box.hidden = true;
  document.body.append(box);
  let shownId = null, ringT = null, lastKey = '';
  const endedSeen = new Set();
  const mine = c => (c.from.role === me.role && c.from.id === me.id()) || (c.to.role === me.role && c.to.id === me.id());

  function render(state) {
    if (!state || !me.id()) return;
    const calls = (state.calls || []).filter(mine);
    const live = calls.find(c => c.status !== 'ended');
    // apel încheiat: un mesaj scurt
    for (const c of calls) {
      if (c.status === 'ended' && !endedSeen.has(c.id) && shownId === c.id) {
        endedSeen.add(c.id);
        const why = { nepreluat: 'Nu a răspuns', respins: 'Apel respins', ocupat: 'Linie ocupată', anulat: 'Apel anulat', terminat: 'Apel încheiat' }[c.endReason] || 'Apel încheiat';
        toast(why, '', 2200, 'phone');
      }
    }
    if (!live) { box.hidden = true; shownId = null; clearInterval(ringT); ringT = null; lastKey = ''; return; }
    shownId = live.id;
    const incoming = live.to.role === me.role && live.to.id === me.id();
    const other = incoming ? live.from : live.to;
    const key = live.id + live.status;
    if (key !== lastKey) {
      lastKey = key;
      box.hidden = false;
      const ph = photo(other);
      box.innerHTML = `<div class="call-card">
        <div class="call-av">${ph ? `<img src="${ph}" alt="">` : esc(initials(label(other)))}</div>
        <div class="call-name">${esc(label(other))}</div>
        <div class="call-st" data-st>${live.status === 'active' ? '0:00' : incoming ? 'te sună…' : 'se apelează…'}</div>
        <div class="call-note">${icon('lock', { size: 15 })}Apel prin centrală · numerele rămân private</div>
        <div class="call-btns">
          ${incoming && live.status === 'ringing' ? `<button class="cbtn no" data-end aria-label="Respinge">${icon('phone', { size: 30 })}</button><button class="cbtn yes" data-ans aria-label="Răspunde">${icon('phone', { size: 30 })}</button>`
          : `<button class="cbtn no" data-end aria-label="Închide">${icon('phone', { size: 30 })}</button>`}
        </div></div>`;
      box.querySelector('[data-end]').onclick = () => bus.act('callEnd', { id: live.id, by: me.role });
      const a = box.querySelector('[data-ans]'); if (a) a.onclick = () => bus.act('callAnswer', { id: live.id });
      clearInterval(ringT); ringT = null;
      if (live.status === 'ringing') {
        const ring = () => { if (incoming) { beep([620, .35, 760, .45], .22); vibrate([400, 200, 400]); } else beep([440, .5], .08); };
        ring(); ringT = setInterval(ring, 2200);
      }
    }
    const st = box.querySelector('[data-st]');
    if (st && live.status === 'active') st.textContent = fmtClock((Date.now() - live.answeredAt) / 1000);
  }
  bus.on(render);
  setInterval(() => render(bus.state), 1000);
  return {
    call(to, orderId) { bus.act('callStart', { from: { role: me.role, id: me.id(), name: me.name() }, to, orderId }); },
  };
}
