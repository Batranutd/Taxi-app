// Sincronizare „în timp real” între ecrane (client, șofer, dispecer) deschise
// în același browser: un tab e „serverul” (lider) și rulează simulatorul,
// celelalte primesc starea. Dacă liderul se închide, alt tab preia automat.
// Într-o versiune de producție, acest fișier se înlocuiește cu un WebSocket spre server.
import { Sim } from './sim.js';

const CH = 'arie-taxi-demo-v2';
const STORE = 'arie-taxi-state-v2';
const LOCK = 'arie-taxi-leader-v2';

export async function connect(map, { role = 'app' } = {}) {
  const tabId = Math.random().toString(36).slice(2);
  const listeners = new Set();
  const sim = new Sim(map);
  const hasBC = 'BroadcastChannel' in self;
  const ch = hasBC ? new BroadcastChannel(CH) : null;
  let state = null;
  let leader = false;
  let dirty = false;
  let tickTimer = null, syncTimer = null, saveTimer = null;
  let lastLeaderMsg = 0;
  let leaderVisible = true;
  let stealing = false;

  const emit = () => { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } };

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.cars || Date.now() - (s.savedAt || 0) > 45 * 60e3) return null;
      return s;
    } catch { return null; }
  }
  function save() {
    if (!state) return;
    try { state.savedAt = Date.now(); localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* plin / blocat */ }
  }
  function broadcast() {
    if (!ch || !state) return;
    ch.postMessage({ type: 'state', from: tabId, visible: document.visibilityState === 'visible', state });
  }
  function markDirty() {
    dirty = true;
  }

  function becomeLeader() {
    leader = true;
    if (!state) state = loadSaved() || sim.fresh();
    clearInterval(tickTimer); clearInterval(syncTimer); clearInterval(saveTimer);
    tickTimer = setInterval(() => {
      const now = Date.now();
      if (sim.tick(state, now)) markDirty();
      if (dirty) { dirty = false; state.v++; emit(); broadcast(); }
    }, 250);
    syncTimer = setInterval(broadcast, 1500);
    saveTimer = setInterval(save, 2000);
    broadcast(); emit();
  }
  function resign() {
    leader = false;
    clearInterval(tickTimer); clearInterval(syncTimer); clearInterval(saveTimer);
  }

  function applyLocal(action, payload) {
    const r = sim.apply(state, action, payload, Date.now());
    if (r === 'reset') { state = sim.fresh(); }
    state.v++;
    dirty = false;
    emit(); broadcast(); save();
  }

  if (ch) {
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.from === tabId) return;
      if (m.type === 'state' && !leader) {
        state = m.state; lastLeaderMsg = Date.now(); leaderVisible = m.visible;
        emit();
      } else if (m.type === 'hello' && leader) {
        broadcast();
      } else if (m.type === 'action' && leader) {
        applyLocal(m.action, m.payload);
      } else if (m.type === 'state' && leader && m.from !== tabId) {
        // doi lideri (nu ar trebui) – cel cu starea mai nouă câștigă
        if (m.state.v > state.v) { state = m.state; emit(); }
      }
    };
  }

  // Alegerea liderului
  const locks = navigator.locks;
  async function queueForLeadership(steal = false) {
    try {
      await locks.request(LOCK, steal ? { steal: true } : {}, async () => {
        becomeLeader();
        await new Promise(() => {}); // păstrează lock-ul cât timp trăiește tab-ul
      });
    } catch (e) {
      // lock-ul ne-a fost „furat” de un tab vizibil: devenim urmăritori
      resign();
      setTimeout(() => queueForLeadership(false), 50);
    }
  }

  if (locks && ch) {
    queueForLeadership(false);
    ch.postMessage({ type: 'hello', from: tabId });
    // Dacă tab-ul lider e în fundal (browserul îl încetinește), un tab vizibil preia conducerea
    setInterval(() => {
      if (leader || stealing) return;
      const visible = document.visibilityState === 'visible';
      const stale = Date.now() - lastLeaderMsg > 4000;
      if (visible && (!leaderVisible || stale) && state) {
        stealing = true;
        setTimeout(() => {
          if (!leader && (!leaderVisible || Date.now() - lastLeaderMsg > 4000)) queueForLeadership(true);
          setTimeout(() => { stealing = false; }, 3000);
        }, 300 + Math.random() * 700);
      }
    }, 1200);
    document.addEventListener('visibilitychange', () => { if (leader) broadcast(); });
  } else {
    becomeLeader();
  }
  addEventListener('pagehide', () => { if (leader) save(); });

  // așteaptă prima stare
  await new Promise(res => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (state) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > 2500 && !leader) {
        // niciun lider nu răspunde (ex. locks blocate): pornim local
        clearInterval(iv); becomeLeader(); res();
      }
    }, 40);
  });

  return {
    get state() { return state; },
    get isLeader() { return leader; },
    map, sim, role,
    on(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    act(action, payload = {}) {
      if (leader) applyLocal(action, payload);
      else if (ch) ch.postMessage({ type: 'action', from: tabId, action, payload });
    },
  };
}
