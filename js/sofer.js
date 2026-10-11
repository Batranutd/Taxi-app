// Aplicația ȘOFER – gândită pentru oricine: butoane mari, puțin text, un singur pas pe ecran.
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, carCategory, queueInfo, stationQueue, etaSeconds, remainingRoute, isNight, STATUS, perKm, clientInfo, reqOptions, carHas, optionLabel, pauseLeft, phoneKey, colorCat } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, TrafficLayer, cssVar } from './mapview.js';
import { icon } from './icons.js';
import { mountCalls } from './calls.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtClock, fmtMoney, firstName, beep, vibrate, speak, store, applyTextSize, applyTheme, navLinks, loadingScreen, unlockAudio, avatar, pickPhoto } from './ui.js';

const L = window.L;
const T = CONFIG.tariff;
const boot = loadingScreen('Pregătim harta pentru tură…');
unlockAudio();

const settings = Object.assign({ theme: 'auto', big: false, voice: true, nav: 'waze', traffic: true }, store.get('driver-settings', {}));
const saveSettings = () => store.set('driver-settings', settings);
const darkNow = () => settings.theme === 'dark' || (settings.theme === 'auto' && isNight());
applyTheme(darkNow());
applyTextSize(settings.big);
document.title = 'Șofer · ' + CONFIG.company.name;

const humanFleetIdx = Math.max(0, CONFIG.fleet.findIndex(f => f.human));
const ME = 'car' + (humanFleetIdx + 1);
let session = store.get('driver-session', null);

let cityMap, bus, map, fleet, route, jobMk, traffic, calls;
const ui = { lastKey: '', follow: true, offerId: null, finishing: null, rating: null, chatSeen: {}, lastMsgT: 0, lastStatus: null, collapsed: false, reqSeen: {}, reqOpen: null, tipSeen: {}, dmSeen: store.get('driver-dm-seen', 0), pauseOverSeen: false };

try { cityMap = await CityMap.load(); } catch (e) { boot.fail('Nu am putut încărca harta. Verifică internetul.'); throw e; }

const app = $('#app');
app.innerHTML = `
  <div class="statusbar" id="sb">
    <button class="icon-btn" id="menuBtn" aria-label="Meniu">${icon('menu', { size: 26 })}<span class="dot-badge" id="menuDot" hidden></span></button>
    <div class="grow"><div class="title" id="sbTitle">—</div><div class="sub" id="sbSub"></div></div>
    <span class="rec" id="rec" hidden title="Înregistrare audio de siguranță activă">●</span>
    <button class="sos-btn" id="sosBtn" aria-label="SOS – ține apăsat 2 secunde"><div class="fill"></div><span>SOS</span></button>
  </div>
  <div class="mapwrap">
    <div id="map" class="map"></div>
    <div class="map-chips"><button class="mchip" id="trafficBtn">${icon('gauge', { size: 18 })}Trafic</button></div>
    <button class="icon-btn recenter" id="recenter" aria-label="Centrează pe mine" hidden>${icon('locate')}</button>
  </div>
  <div class="dpanel" id="panel">
    <button class="grab-btn" id="grab" aria-label="Coboară sau ridică panoul"><span class="grab"></span></button>
    <div id="panelBody"></div>
  </div>
  <div class="demo-badge" style="top:auto;bottom:calc(8px + var(--safe-b));left:10px;right:auto">DEMO · x<span id="spd">1</span></div>
`;
map = createMap($('#map'), { dark: darkNow(), cityMap, zoom: 15 });
traffic = new TrafficLayer(map, cityMap);
route = new RouteLine(map);
bus = await connect(cityMap, { role: 'sofer' });
window.taxiDemo = bus;
fleet = new FleetLayer(map, { me: ME, onFrame: frame, tag: c => c.id === ME ? 'TU' : '' });
map.on('dragstart', () => { ui.follow = false; $('#recenter').hidden = false; });
$('#recenter').onclick = () => { ui.follow = true; $('#recenter').hidden = true; followMe(true); };
$('#menuBtn').onclick = openMenu;
$('#trafficBtn').onclick = () => { settings.traffic = !settings.traffic; saveSettings(); applyTraffic(); toast(settings.traffic ? 'Străzile aglomerate apar cu portocaliu și roșu' : 'Trafic ascuns', '', 2200, 'gauge'); };
setupSos();
setupPanelDrag();
calls = mountCalls(bus, { role: 'sofer', id: () => ME, name: () => (me() || {}).driver || '' }, {
  label: p => p.role === 'client' ? clientInfo(bus.state, { phone: p.id }).name + ' · client' : p.role === 'dispecer' ? 'Dispecerat' : p.name,
  photo: p => p.role === 'client' ? clientInfo(bus.state, { phone: p.id }).photo : null,
});
function applyTraffic() { traffic.show(!!settings.traffic); $('#trafficBtn').classList.toggle('on', !!settings.traffic); }
applyTraffic();

// ---------- stare ----------
function me() { return bus && bus.state && bus.state.cars.find(c => c.id === ME); }
function myOrder() { const c = me(); return c && c.orderId ? bus.state.orders.find(o => o.id === c.orderId) : null; }
function myOffer() { return bus.state && bus.state.orders.find(o => o.status === 'oferita' && o.offer && o.offer.carId === ME); }
const pendingRequests = () => bus.state.orders.filter(o => o.status === 'programata' && o.request && o.request.status === 'pending' && o.request.carId === ME);
const myReservations = () => bus.state.orders.filter(o => o.status === 'programata' && o.reservedBy === ME).sort((a, b) => a.scheduledFor - b.scheduledFor);

function onState(state) {
  if (!state) return;
  $('#spd').textContent = state.speedMul;
  fleet.update(state);
  traffic.refresh();
  const car = me();
  if (session && car && car.status === STATUS.offline && !ui.loggingOut) bus.act('driverLogin', { carId: ME });
  $('#rec').hidden = !(car && car.recording);
  // ofertă nouă
  const off = myOffer();
  if (off && ui.offerId !== off.id) showOffer(off);
  if (!off && ui.offerId) closeOffer();
  // cereri programate de la clienți (ex. când sunt în pauză)
  const req = pendingRequests().find(o => !ui.reqSeen[o.id]);
  if (req && session && !off) { ui.reqSeen[req.id] = true; showRequest(req); }
  // mesaje de la client
  const o = myOrder();
  for (const ord of [o, ...myReservations()].filter(Boolean)) {
    const msgs = (state.chats[ord.id] || []).filter(m => m.from !== 'sofer');
    const last = msgs[msgs.length - 1];
    if (last && last.t > ui.lastMsgT && !document.querySelector('.chat-ov')) {
      ui.lastMsgT = last.t;
      toast(`<b>${esc(firstName(ord.client.name))}:</b> ${esc(last.text)}`, '', 6000, 'message'); beep([990, .1, 990, .1]); vibrate([80, 60, 80]);
      if (settings.voice) speak('Mesaj de la client. ' + last.text);
    }
  }
  // mesaje de la dispecerat
  const dms = state.driverMsgs.filter(m => (m.to === ME || m.to === 'toti') && m.from === 'dispecer');
  const newDm = dms.filter(m => m.t > ui.dmSeen);
  if (newDm.length && session) {
    const m = newDm[newDm.length - 1];
    toast(`<b>Dispecerat:</b> ${esc(m.text)}`, 'warn', 7000, 'headset'); beep([700, .12, 700, .12]);
    if (settings.voice) speak('Mesaj de la dispecerat. ' + m.text);
    ui.dmSeen = m.t; store.set('driver-dm-seen', m.t);
  }
  // bacșiș primit
  state.orders.filter(x => x.carId === ME && x.tip && !ui.tipSeen[x.id]).forEach(x => {
    ui.tipSeen[x.id] = true;
    if (Date.now() - x.finishedAt < 10 * 60e3) { toast(`${esc(firstName(x.client.name))} ți-a lăsat ${fmtMoney(x.tip.amount)} lei bacșiș${x.tip.method === 'card' ? ' (card)' : ''}`, 'ok', 6000, 'gift'); beep([880, .1, 1320, .2]); if (settings.voice) speak(`Ai primit ${Math.round(x.tip.amount)} lei bacșiș.`); }
  });
  if (o && ui.lastStatus && o.status !== ui.lastStatus && o.status === 'anulata') { toast('Clientul a anulat comanda.', 'bad', 5000); vibrate(300); }
  ui.lastStatus = o ? o.status : null;
  if (ui.trackOrder && !o) {
    const prev = state.orders.find(x => x.id === ui.trackOrder);
    if (prev && prev.status === 'anulata' && prev.cancelledBy === 'client') { toast('Clientul a anulat comanda. Ești din nou liber.', 'warn', 6000); beep([600, .2, 400, .3]); vibrate(300); if (settings.voice) speak('Clientul a anulat comanda.'); }
    ui.trackOrder = null;
  }
  if (o) {
    if (ui.trackOrder !== o.id && o.fromReservation) { toast('A început cursa rezervată. Pornește spre client.', 'ok', 6000, 'calendar'); beep([660, .1, 990, .15]); if (settings.voice) speak('A început cursa rezervată. Pornește spre ' + o.pickup.label); }
    ui.trackOrder = o.id;
  }
  // pauza s-a terminat
  if (car && car.pauseOver && !ui.pauseOverSeen) { ui.pauseOverSeen = true; beep([660, .15, 880, .2]); vibrate(200); if (settings.voice) speak('Pauza s-a terminat.'); }
  if (car && !car.pauseOver) ui.pauseOverSeen = false;
  $('#menuDot').hidden = !pendingRequests().length;
  render();
}

// ---------- panou glisant ----------
function setCollapsed(v) { ui.collapsed = v; $('#panel').classList.toggle('collapsed', v); }
function setupPanelDrag() {
  const grab = $('#grab'), panel = $('#panel');
  let y0 = null, moved = false;
  const start = e => { y0 = e.clientY; moved = false; };
  const move = e => { if (y0 === null) return; const dy = e.clientY - y0; if (Math.abs(dy) > 8) moved = true; if (dy > 0 && !ui.collapsed) panel.style.transform = `translateY(${Math.min(dy, 240)}px)`; };
  const end = e => {
    if (y0 === null) return; const dy = e.clientY - y0; y0 = null; panel.style.transform = '';
    if (!moved) { setCollapsed(!ui.collapsed); return; }
    if (dy > 50) setCollapsed(true); else if (dy < -30) setCollapsed(false);
  };
  grab.addEventListener('pointerdown', e => { grab.setPointerCapture(e.pointerId); start(e); });
  grab.addEventListener('pointermove', move);
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', () => { y0 = null; panel.style.transform = ''; });
  const pb = $('#panelBody');
  pb.addEventListener('pointerdown', e => { if (e.target.closest('.dpeek') && !e.target.closest('button, a')) { start(e); pb.setPointerCapture(e.pointerId); } });
  pb.addEventListener('pointermove', move);
  pb.addEventListener('pointerup', e => { if (y0 !== null) end(e); });
}

// ---------- randare ----------
function render() {
  const car = me(); if (!car || !session) return;
  const o = myOrder();
  const fin = ui.finishing ? bus.state.orders.find(x => x.id === ui.finishing) : null;
  const rate = ui.rating ? bus.state.orders.find(x => x.id === ui.rating) : null;
  let scr;
  if (rate) scr = 'rate';
  else if (fin) scr = 'paid';
  else if (!o) scr = car.status === STATUS.pauza ? 'pause' : 'idle';
  else scr = { acceptata: 'pickup', sosit: 'waiting', in_cursa: 'ride' }[o.status] || 'idle';

  const cat = carCategory(car);
  const sb = $('#sb');
  sb.className = 'statusbar ' + (scr === 'paid' || scr === 'rate' ? 'liber_drum' : cat);
  const qi = queueInfo(bus.state, car);
  const titles = { idle: 'LIBER', pause: 'PAUZĂ', pickup: 'MERGI LA CLIENT', waiting: 'LA ADRESĂ · AȘTEPȚI', ride: 'CU CLIENT', paid: 'CURSĂ TERMINATĂ', rate: 'EVALUEAZĂ CLIENTUL' };
  $('#sbTitle').textContent = titles[scr];
  const left = pauseLeft(car);
  $('#sbSub').textContent = scr === 'pause' ? (car.pauseOver ? 'Pauza s-a terminat' : left != null ? `Revii în ${fmtClock(left)}` : 'Până revii') : qi && scr === 'idle' ? `Stația ${qi.station.name} · ${qi.pos === 1 ? 'ești primul la rând' : `ești al ${qi.pos}-lea la rând`}` : `Indicativ ${car.cs} · ${car.plate}`;

  const resKey = myReservations().map(x => x.id).join(',') + '|' + pendingRequests().map(x => x.id).join(',');
  const key = [scr, o ? o.id + o.status : '', fin ? fin.id + fin.paid + fin.status + fin.fare : '', rate ? rate.id : '', car.status, car.station || '', qi ? qi.pos + '/' + qi.total : '', car.move ? car.move.kind : '', document.documentElement.dataset.theme, car.pauseOver, car.pauseUntil, resKey, car.atPickup].join('|');
  if (key !== ui.lastKey) {
    const prevScr = ui.lastKey.split('|')[0];
    ui.lastKey = key;
    $('#panelBody').innerHTML = PANELS[scr](car, o || fin || rate);
    BIND[scr] && BIND[scr](car, o || fin || rate);
    if (prevScr !== scr) { updateMap(scr, car, o); if (['pickup', 'waiting', 'ride', 'paid', 'rate'].includes(scr) && prevScr) setCollapsed(false); }
  }
  refresh(scr, car, o);
}

function updateMap(scr, car, o) {
  if (jobMk) { map.removeLayer(jobMk); jobMk = null; }
  route.setDashed(false);
  if (o && (scr === 'pickup' || scr === 'waiting')) {
    jobMk = L.marker([o.pickup.lat, o.pickup.lon], { icon: pinIcon('pickup', 'person'), zIndexOffset: 3000 }).addTo(map);
    route.set(remainingRoute(car), cssVar('--to'));
  } else if (o && scr === 'ride') {
    const d = o.dest || o.destInCar;
    if (d) jobMk = L.marker([d.lat, d.lon], { icon: pinIcon('dest', 'flag'), zIndexOffset: 3000 }).addTo(map);
    route.set(remainingRoute(car), cssVar('--busy'));
  } else if (car.move && car.move.kind === 'station') {
    route.set(remainingRoute(car), cssVar('--free'));
    route.setDashed(true);
  } else route.clear();
  followMe(true);
}

function followMe(force) {
  const car = me(); if (!car) return;
  if (!ui.follow && !force) return;
  const o = myOrder();
  const p = carPos(car).p;
  if (force) map.invalidateSize({ pan: false });
  if (force && o) {
    const target = o.status === 'in_cursa' ? (o.dest || o.destInCar) : o.pickup;
    if (target) { if (ui.follow) map.fitBounds(L.latLngBounds([p, [target.lat, target.lon]]), { padding: [60, 60], maxZoom: 17 }); return; }
  }
  if (force) map.setView(p, Math.max(map.getZoom(), 15), { animate: true });
  else map.panTo(p, { animate: true, duration: 0.8 });
}

let lastFollow = 0, lastRef = 0, lastRoute = 0;
function frame(now) {
  const car = me(); if (!car) return;
  if (ui.follow && car.move && now - lastFollow > 2500) { lastFollow = now; followMe(false); }
  if (now - lastRef > 500) { lastRef = now; refresh(null, car, myOrder()); }
  if (now - lastRoute > 1200 && car.move) { lastRoute = now; route.set(remainingRoute(car)); }
}

function refresh(scr, car, o) {
  $$('[data-eta]').forEach(el => { el.textContent = car.move ? fmtMin(etaSeconds(car)) : '—'; });
  $$('[data-dist]').forEach(el => { el.textContent = car.move ? fmtKm(carPos(car).remaining) : '0 m'; });
  const near = o && o.status === 'acceptata' && (car.atPickup || dist(carPos(car).p, [o.pickup.lat, o.pickup.lon]) < 200);
  const arr = $('#arrivedBtn');
  if (arr) {
    arr.classList.toggle('wait', !near); arr.classList.toggle('go', near); arr.classList.toggle('pulse', near);
    arr.innerHTML = near ? `${icon('check', { size: 30, stroke: 2.8 })}AM AJUNS` : `<span class="small-l">Ajungi în <b data-eta>${car.move ? fmtMin(etaSeconds(car)) : '—'}</b></span><span>AM AJUNS</span>`;
    if (near && ui.nearAnnounced !== o.id) { ui.nearAnnounced = o.id; beep([700, .1, 1050, .15]); vibrate(120); if (settings.voice) speak('Ai ajuns la adresă. Apasă Am ajuns, ca să-l anunțăm pe client.'); }
  }
  if (o && o.status === 'sosit' && o.arrivedAt) {
    const sec = (Date.now() - o.arrivedAt) / 1000 * bus.state.speedMul;
    $$('[data-wait-t]').forEach(t => { t.textContent = fmtClock(sec); });
    const fw = $('#freeWait'); if (fw) fw.innerHTML = sec < T.freeWaitMin * 60 ? `Gratuit încă ${fmtClock(T.freeWaitMin * 60 - sec)}` : `<b style="color:var(--warn)">Se taxează așteptarea · ${fmtMoney(T.perMinWait)} lei/min</b>`;
    const ns = $('#noShowBtn'); if (ns) ns.hidden = sec < 5 * 60;
  }
  const atDest = o && o.status === 'in_cursa' && car.atDest;
  const fb = $('#finishBtn'); if (fb) fb.classList.toggle('pulse', !!atDest);
  if (atDest && ui.destAnnounced !== o.id) { ui.destAnnounced = o.id; beep([700, .1, 1050, .15]); vibrate(120); if (settings.voice) speak('Ai ajuns la destinație.'); }
  if (o) {
    const unread = (bus.state.chats[o.id] || []).filter(m => m.from !== 'sofer').length - (ui.chatSeen[o.id] || 0);
    $$('[data-unread]').forEach(el => { el.hidden = unread <= 0; el.textContent = unread; });
  }
  $$('[data-pause-left]').forEach(pl => { const left = pauseLeft(car); pl.textContent = left != null ? fmtClock(left) : '—'; });
  const st = $('#todayStats');
  if (st) {
    const e = car.earnings;
    const hrs = (Date.now() - (car.shiftStart || Date.now())) / 3600e3;
    st.innerHTML = `
      <div class="stat"><div class="k">Curse azi</div><div class="v">${e.rides}</div></div>
      <div class="stat"><div class="k">Încasat azi</div><div class="v">${Math.round(e.cash + e.card)} lei</div></div>
      <div class="stat"><div class="k">În tură</div><div class="v">${Math.floor(hrs)}h ${String(Math.floor(hrs % 1 * 60)).padStart(2, '0')}m</div></div>`;
  }
}

// ---------- panouri ----------
function optionTags(o, car) {
  return reqOptions(o.options).map(k => { const op = CONFIG.options.find(x => x.key === k); const ok = car ? carHas(car, k) : true; return `<span class="pill ${ok ? '' : 'warn'}" style="font-size:.85em;padding:6px 10px">${icon(op.icon, { size: 18 })}${op.short}${ok ? '' : ' · nu ai'}</span>`; }).join('');
}
function payTag(o) {
  return o.payment === 'card'
    ? `<span class="pay-tag card">${icon('card', { size: 20 })}Card · automat</span>`
    : `<span class="pay-tag cash">${icon('cash', { size: 20 })}Plată cash</span>`;
}
function clientRow(o, withTools = true) {
  const ci = clientInfo(bus.state, o.client);
  return `<div class="client-row">${avatar(ci.name, ci.photo, 48)}<div class="grow"><b>${esc(ci.name)}</b><div class="small muted">${ci.rating ? `★ ${ci.rating.toLocaleString('ro-RO')} · ` : ''}${ci.rides ? `${ci.rides} curse` : 'Client nou'}</div></div>
    ${withTools ? `<button class="tool sq" data-call>${icon('phone', { size: 24 })}</button><button class="tool sq" data-chat>${icon('message', { size: 24 })}<span class="badge" data-unread hidden></span></button>` : ''}</div>`;
}
function noteBox(o) {
  return o.note ? `<div class="job-note">${icon('pin', { size: 22 })}<div><div class="small" style="font-weight:800;opacity:.75">Indicații de la client</div>„${esc(o.note)}”</div></div>` : '';
}
const peekRow = (title, sub = '') => `<div class="dpeek"><div class="grow"><div class="pk-t">${title}</div>${sub ? `<div class="pk-s">${sub}</div>` : ''}</div><button class="icon-btn flat sm-btn" data-collapse aria-label="Coboară panoul">${icon('chevron', { size: 20 })}</button></div>`;

function upcomingCards() {
  const req = pendingRequests(), res = myReservations();
  return [
    ...req.map(o => `<button class="up-card req" data-req="${o.id}">${icon('calendar', { size: 22 })}<div class="grow"><b>Cerere de la ${esc(firstName(o.client.name))} · ${fmtTime(o.scheduledFor)}</b><div class="small">${esc(o.pickup.label)} · atinge ca să răspunzi</div></div>${icon('chevron', { size: 18 })}</button>`),
    ...res.map(o => `<div class="up-card"><span class="up-time">${fmtTime(o.scheduledFor)}</span><div class="grow"><b>Cursă rezervată${sameDay(o.scheduledFor) ? '' : ' · ' + dayShort(o.scheduledFor)}</b><div class="small">${esc(o.pickup.label)}${o.dest ? ' → ' + esc(o.dest.label) : ''}</div></div><button class="tool sq" data-chat-o="${o.id}">${icon('message', { size: 22 })}</button></div>`),
  ].join('');
}
const sameDay = t => new Date(t).toDateString() === new Date().toDateString();
const dayShort = t => new Date(t).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' });

const PANELS = {
  idle(car) {
    const qi = queueInfo(bus.state, car);
    const p = carPos(car).p;
    const nearest = CONFIG.stations.map(s => ({ s, d: dist(p, [s.lat, s.lon]) })).sort((a, b) => a.d - b.d)[0];
    const goingTo = car.move && car.move.kind === 'station' ? CONFIG.stations.find(s => s.id === car.targetStation) : null;
    const pre = bus.state.orders.filter(x => x.status === 'programata' && !x.reservedBy && !(x.request && x.request.status === 'pending')).length;
    return `
      ${peekRow('Liber · aștepți comenzi', qi ? `Stația ${esc(qi.station.name)} · ${qi.pos === 1 ? 'primul la rând' : `al ${qi.pos}-lea la rând`}` : goingTo ? `Spre Stația ${esc(goingTo.name)}` : 'Primești comenzi după distanță')}
      <div class="dmain">
        <div class="state-toggle">
          <button class="on free" data-st="liber">${icon('check', { size: 28, stroke: 3 })}LIBER</button>
          <button data-st="pauza">${icon('pause', { size: 26 })}PAUZĂ</button>
        </div>
        ${upcomingCards()}
        ${qi ? `
          <div class="queue-card"><div class="pos"><span class="n">${qi.pos}</span><span class="l">${qi.pos === 1 ? 'PRIMUL' : 'LA RÂND'}</span></div><div class="grow"><div class="t">Stația ${esc(qi.station.name)}</div><div class="muted small">${qi.total} ${qi.total === 1 ? 'mașină' : 'mașini'} în stație · ${esc(qi.station.hint)}</div></div></div>`
        : goingTo ? `
          <div class="queue-card"><div class="pos">${icon('nav', { size: 30 })}</div><div class="grow"><div class="t">Mergi spre Stația ${esc(goingTo.name)}</div><div class="muted small">Ajungi în <span data-eta>—</span> · intri automat la rând</div></div></div>`
        : `
          <div class="queue-card off"><div class="pos">${icon('stand', { size: 30 })}</div><div class="grow"><div class="t">Nu ești într-o stație</div><div class="muted small">Primești comenzi după distanță</div></div></div>
          <button class="btn go block xl mt" data-gostation="${nearest.s.id}">${icon('nav')}Mergi la Stația ${esc(nearest.s.name)} · ${fmtKm(nearest.d)}</button>`}
        <div class="today" id="todayStats"></div>
        <div class="grid2 mt">
          <button class="btn block" id="stationsBtn">${icon('stand')}Stații</button>
          <button class="btn block" id="preBtn">${icon('calendar')}Precomenzi${pre ? ` <b class="cnt">${pre}</b>` : ''}</button>
        </div>
      </div>`;
  },

  pause(car) {
    const left = pauseLeft(car);
    return `
      ${peekRow(car.pauseOver ? 'Pauza s-a terminat' : 'Ești în pauză', car.pauseOver ? 'Apasă LIBER ca să primești comenzi' : left != null ? `Revii în <b data-pause-left>${fmtClock(left)}</b>` : 'Fără durată stabilită')}
      <div class="dmain">
        ${car.pauseOver ? `<div class="pause-over">${icon('clock', { size: 28 })}<div><b>Pauza s-a terminat</b><div class="small">Treci pe LIBER ca să primești comenzi.</div></div></div>` : ''}
        <div class="state-toggle">
          <button class="${car.pauseOver ? 'pulse-free' : ''}" data-st="liber">${icon('check', { size: 28, stroke: 3 })}LIBER</button>
          <button class="on pause" data-st="pauza">${icon('pause', { size: 26 })}PAUZĂ</button>
        </div>
        ${upcomingCards()}
        <div class="pause-box">
          <div class="muted" style="font-weight:700">${left != null ? 'Revii pe LIBER în' : 'Pauză fără durată'}</div>
          ${left != null ? `<div class="big-timer" data-pause-left>${fmtClock(left)}</div>` : ''}
          <div class="grid3 mt">${[5, 10, 15].map(m => `<button class="btn" data-ext="${m}">+${m} min</button>`).join('')}</div>
          <p class="small muted" style="margin:10px 0 0">Pe hartă apari ca mașină transparentă. Clienții te pot rezerva pentru când îți termini pauza, iar tu accepți sau refuzi.</p>
        </div>
        <div class="today" id="todayStats"></div>
      </div>`;
  },

  pickup(car, o) {
    const jams = cityMap.jams(1.6).slice(0, 2);
    return `
      ${peekRow(esc(o.pickup.label), `Ajungi în <b data-eta>—</b> · <span data-dist>—</span>`)}
      <div class="dmain">
        ${o.fromReservation ? `<div class="up-card req" style="margin:0 0 10px">${icon('calendar', { size: 22 })}<div class="grow"><b>Cursă rezervată din timp</b><div class="small">Clientul te așteaptă la ${fmtTime(o.scheduledFor)}</div></div></div>` : ''}
        ${clientRow(o)}
        ${noteBox(o)}
        <div class="job-meta">${payTag(o)}${optionTags(o, car)}</div>
        <div class="route-info">${icon('route', { size: 18 })}<span>Cea mai rapidă rută, cu trafic live${car.move && car.move.slow > 1.15 ? ` · aglomerat (+${Math.round((car.move.slow - 1) * 100)}%)` : ''}${jams.length ? `<span class="muted" style="font-weight:600"> · evită ${jams.map(j => esc(j.name)).join(', ')}</span>` : ''}</span></div>
        <button class="tool nav big" data-nav>${icon('nav', { size: 26 })}Navighează cu ${settings.navAsk === false ? (settings.nav === 'google' ? 'Google Maps' : 'Waze') : 'Waze / Maps'}</button>
        <button class="btn step block wait" id="arrivedBtn">AM AJUNS</button>
        <button class="linkbtn" id="cancelJob">Nu pot ajunge – anunță dispeceratul</button>
      </div>`;
  },

  waiting(car, o) {
    return `
      ${peekRow('Aștepți clientul', `de <b data-wait-t>0:00</b>`)}
      <div class="dmain">
        <div class="hstack between"><div><div class="muted" style="font-weight:800">Aștepți de</div><div class="big-timer" data-wait-t>0:00</div></div>
        <div style="text-align:right"><div class="small" id="freeWait"></div></div></div>
        ${clientRow(o)}
        ${noteBox(o)}
        <div class="job-meta">${payTag(o)}${optionTags(o, car)}</div>
        <button class="btn step go block" id="pickedBtn">${icon('person', { size: 30 })}CLIENTUL A URCAT</button>
        <button class="btn danger-soft block mt" id="noShowBtn" hidden>Clientul nu a venit</button>
      </div>`;
  },

  ride(car, o) {
    const d = o.dest || o.destInCar;
    return `
      ${peekRow(esc(d ? d.label : 'Destinație'), `Ajungi în <b data-eta>—</b>`)}
      <div class="dmain">
        <div class="muted" style="font-weight:800">${o.dest ? 'Duci clientul la' : 'Destinația spusă de client'}</div>
        <div class="job-addr">${esc(d ? d.label : '—')}</div>
        <div class="grid2 mt">
          <div class="stat"><div class="k">Ajungi în</div><div class="v" data-eta>—</div></div>
          <div class="stat"><div class="k">${o.estimate ? 'Estimat' : 'Tarif'}</div><div class="v">${o.estimate ? `${o.estimate.low}–${o.estimate.high} lei` : `${fmtMoney(perKm())} lei/km`}</div></div>
        </div>
        <div class="job-meta">${payTag(o)}</div>
        <div class="tool-row" style="grid-template-columns:2fr 1fr">
          <button class="tool nav" data-nav>${icon('nav', { size: 26 })}Navighează</button>
          <button class="tool" data-chat>${icon('message', { size: 26 })}Mesaj<span class="badge" data-unread hidden></span></button>
        </div>
        <button class="btn step dark block" id="finishBtn">${icon('flag', { size: 28 })}CURSĂ TERMINATĂ</button>
      </div>`;
  },

  paid(car, o) {
    const fare = o.fare ?? ui.finishFare;
    if (o.payment === 'card') {
      return `
        ${peekRow('Încasat automat', `${fmtMoney(fare)} lei de pe card`)}
        <div class="dmain center" style="padding-top:4px">
          <div class="bubble" style="margin:0 auto 10px;width:72px;height:72px;border-radius:22px;background:var(--free);color:#fff">${icon('check', { size: 40, stroke: 3 })}</div>
          <div class="muted" style="font-weight:800">Încasat automat de pe card</div>
          <div class="amount" style="font-size:2.6em">${fmtMoney(fare)} lei</div>
          <div class="muted">${esc(o.card ? `${o.card.brand} •••• ${o.card.last4}` : '')} · bonul a ajuns la client</div>
          <button class="btn go step block mt" id="doneBtn">CONTINUĂ</button>
        </div>`;
    }
    return `
      ${peekRow('Încasează cash', `${fmtMoney(fare)} lei`)}
      <div class="dmain center" style="padding-top:4px">
        <div class="bubble accent" style="margin:0 auto 10px;width:72px;height:72px;border-radius:22px">${icon('cash', { size: 40 })}</div>
        <div class="muted" style="font-weight:800">Ia de la client, cash:</div>
        <div class="amount" style="font-size:2.8em">${fmtMoney(fare)} lei</div>
        <div class="muted small">Nu uita bonul de la taximetru.</div>
        <button class="btn go step block mt" id="cashBtn">${icon('check', { size: 30, stroke: 2.8 })}AM ÎNCASAT</button>
      </div>`;
  },

  rate(car, o) {
    const r = ui.rate || (ui.rate = { stars: 0, tags: [], text: '' });
    const ci = clientInfo(bus.state, o.client);
    return `
      ${peekRow('Cum a fost clientul?', esc(ci.name))}
      <div class="dmain">
        <div class="client-row" style="justify-content:center;background:none">${avatar(ci.name, ci.photo, 56)}<div><b style="font-size:1.15em">${esc(ci.name)}</b><div class="small muted">${ci.rides} curse</div></div></div>
        <div class="stars big">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= r.stars ? 'on' : ''}" aria-label="${i} stele">${icon('star', { size: 46, stroke: 1.6 })}</button>`).join('')}</div>
        <div class="chips wrap" style="justify-content:center" ${r.stars ? '' : 'hidden'}>
          ${(r.stars >= 4 ? ['Punctual', 'Politicos', 'A respectat mașina', 'Indicații clare'] : ['A întârziat', 'Nepoliticos', 'A murdărit mașina', 'Adresă greșită']).map(t => `<button class="chip ${r.tags.includes(t) ? 'on' : ''}" data-tag="${t}">${t}</button>`).join('')}
        </div>
        <label class="field mt" ${r.stars ? '' : 'hidden'}><span>Ceva nu a fost în regulă? (opțional)</span><textarea class="input" id="rText" placeholder="Scrie pe scurt">${esc(r.text)}</textarea></label>
        <button class="btn go step block mt" id="rateSend" ${r.stars ? '' : 'disabled'}>TRIMITE</button>
        <button class="linkbtn" id="rateSkip">Sari peste</button>
      </div>`;
  },
};

const BIND = {
  idle() { bindState(); bindIdle(); bindUpcoming(); },
  pause(car) {
    bindState(); bindUpcoming();
    $$('[data-ext]').forEach(b => b.onclick = () => { bus.act('extendPause', { carId: ME, minutes: +b.dataset.ext }); toast(`Pauza a fost prelungită cu ${b.dataset.ext} minute`, '', 2000, 'clock'); });
  },
  pickup(car, o) {
    bindJob(o);
    $('#arrivedBtn').onclick = () => {
      const near = me().atPickup || dist(carPos(me()).p, [o.pickup.lat, o.pickup.lon]) < 200;
      if (!near) { toast('Încă nu ești la adresă. Butonul se activează când ajungi.', 'warn', 3000); return; }
      bus.act('arrived', { orderId: o.id }); beep([880, .12]);
      toast('Clientul a fost anunțat că ai ajuns.', 'ok', 3000, 'check');
    };
    $('#cancelJob').onclick = async () => {
      if (await confirmBox('Renunți la comandă?', 'Comanda se trimite imediat altui șofer. Folosește doar dacă nu poți ajunge (pană, accident, blocaj).', { yes: 'Da, renunț', no: 'Nu', danger: true })) {
        bus.act('driverDrop', { orderId: o.id }); toast('Comanda a fost trimisă altui șofer.', '', 3000);
      }
    };
  },
  waiting(car, o) {
    bindJob(o);
    $('#pickedBtn').onclick = () => { bus.act('pickedUp', { orderId: o.id }); beep([660, .1, 990, .12]); };
    $('#noShowBtn').onclick = async () => {
      if (await confirmBox('Clientul nu a venit?', 'Ai așteptat peste 5 minute. Comanda se închide, iar dispeceratul e anunțat.', { yes: 'Da, închide comanda', no: 'Mai aștept', danger: true })) bus.act('noShow', { orderId: o.id });
    };
  },
  ride(car, o) { bindJob(o); $('#finishBtn').onclick = () => openMeter(o); },
  paid(car, o) {
    const next = () => { ui.finishing = null; ui.rating = o.id; ui.rate = null; ui.lastKey = ''; render(); };
    const d = $('#doneBtn'); if (d) d.onclick = next;
    const c = $('#cashBtn'); if (c) c.onclick = () => { bus.act('collectCash', { orderId: o.id }); toast(`Încasat ${fmtMoney(o.fare ?? ui.finishFare)} lei cash`, 'ok', 2500, 'check'); next(); };
  },
  rate(car, o) {
    const r = ui.rate;
    const re = () => { ui.lastKey = ''; render(); };
    $$('[data-star]').forEach(b => b.onclick = () => { r.stars = +b.dataset.star; r.tags = []; re(); });
    $$('[data-tag]').forEach(b => b.onclick = () => { const t = b.dataset.tag; r.tags = r.tags.includes(t) ? r.tags.filter(x => x !== t) : [...r.tags, t]; b.classList.toggle('on'); });
    const tx = $('#rText'); if (tx) tx.oninput = () => { r.text = tx.value; };
    const done = () => { ui.rating = null; ui.rate = null; ui.lastKey = ''; render(); suggestStation(); };
    $('#rateSend').onclick = () => { bus.act('rateClient', { orderId: o.id, stars: r.stars, tags: r.tags, text: r.text.trim() }); toast('Mulțumim! Evaluarea a fost trimisă.', 'ok', 2000, 'check'); done(); };
    $('#rateSkip').onclick = done;
  },
};

function bindCommonPanel() {
  $$('[data-collapse]').forEach(b => b.onclick = () => setCollapsed(!ui.collapsed));
}
function bindState() {
  bindCommonPanel();
  $$('[data-st]').forEach(b => b.onclick = () => {
    const s = b.dataset.st;
    const car = me();
    if (s === 'pauza') { if (car.status === STATUS.pauza) return; openPauseChooser(); return; }
    bus.act('driverStatus', { carId: ME, status: STATUS.liber });
    beep([990, .12]);
  });
}
function bindIdle() {
  $$('[data-gostation]').forEach(b => b.onclick = () => { bus.act('goStation', { carId: ME, stationId: b.dataset.gostation }); ui.follow = true; });
  $('#stationsBtn').onclick = openStations;
  $('#preBtn').onclick = openPreorders;
}
function bindUpcoming() {
  $$('[data-req]').forEach(b => b.onclick = () => { const o = bus.state.orders.find(x => x.id === b.dataset.req); if (o) showRequest(o); });
  $$('[data-chat-o]').forEach(b => b.onclick = () => { const o = bus.state.orders.find(x => x.id === b.dataset.chatO); if (o) openChat(o); });
}
function bindJob(o) {
  bindCommonPanel();
  $$('[data-nav]').forEach(b => b.onclick = () => openNav(o));
  $$('[data-call]').forEach(b => b.onclick = () => calls.call({ role: 'client', id: phoneKey(o.client.phone), name: o.client.name }, o.id));
  $$('[data-chat]').forEach(b => b.onclick = () => openChat(o));
}

function suggestStation() {
  const car = me(); if (!car || car.station || car.move || car.orderId) return;
  const p = carPos(car).p;
  const s = CONFIG.stations.map(s => ({ s, d: dist(p, [s.lat, s.lon]), n: stationQueue(bus.state, s.id).length })).sort((a, b) => a.d - b.d)[0];
  toast(`Cea mai apropiată stație: ${esc(s.s.name)} (${fmtKm(s.d)}, ${s.n} mașini).`, '', 4000, 'stand');
}

// ---------- pauză cu durată ----------
function openPauseChooser() {
  const ov = modal(`
    <div class="panel-head"><h2>Cât durează pauza?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin:-6px 0 12px">Clienții văd pe hartă când revii și te pot rezerva pentru atunci.</p>
    <div class="grid3">${[5, 10, 15, 20, 30, 45].map(m => `<button class="btn xl" data-m="${m}">${m} min</button>`).join('')}</div>
    <button class="btn dark block xl mt" data-m="0">${icon('pause')}Până revin</button>
  `);
  $$('[data-m]', ov).forEach(b => b.onclick = () => {
    const m = +b.dataset.m;
    bus.act('driverStatus', { carId: ME, status: STATUS.pauza, minutes: m || null });
    ov.close(); beep([520, .12]);
    toast(m ? `Pauză ${m} minute. Te anunțăm când se termină.` : 'Pauză fără durată. Apasă LIBER când revii.', '', 3000, 'pause');
  });
}

// ---------- cerere programată de la un client ----------
function showRequest(o) {
  if (document.querySelector('.req-ov')) return;
  const ci = clientInfo(bus.state, o.client);
  const car = me();
  const ov = modal(`
    <div class="small" style="font-weight:850;letter-spacing:.06em;color:var(--to);text-transform:uppercase">Cerere programată</div>
    <div class="client-big">${avatar(ci.name, ci.photo, 64)}<div class="grow"><div style="font-weight:850;font-size:1.25em">${esc(ci.name)}</div><div class="small muted">${ci.rating ? `★ ${ci.rating.toLocaleString('ro-RO')} · ` : ''}${ci.rides ? `${ci.rides} curse` : 'Client nou'}</div></div></div>
    <div class="req-time">${icon('clock', { size: 26 })}<div><div class="small muted" style="font-weight:700">Vrea să meargă cu tine la</div><b>${fmtTime(o.scheduledFor)}</b>${car.pauseUntil && Math.abs(car.pauseUntil - o.scheduledFor) < 90e3 ? ' <span class="small muted">(când îți termini pauza)</span>' : ''}</div></div>
    <div class="from-box"><div class="lbl">De la</div><div class="addr">${esc(o.pickup.label)}</div>${o.dest ? `<div class="small" style="margin-top:4px">până la <b>${esc(o.dest.label)}</b>${o.estimate ? ` · ${o.estimate.low}–${o.estimate.high} lei` : ''}</div>` : ''}</div>
    ${noteBox(o)}
    <div class="job-meta">${payTag(o)}${optionTags(o, car)}</div>
    ${ci.reviews.length ? `<div class="rev-box">${ci.reviews.slice(0, 2).map(r => `<div class="review"><span class="stars-s">${'★'.repeat(r.stars)}</span> ${esc(r.text)}<div class="who">${esc(r.by)}, șofer</div></div>`).join('')}</div>` : ''}
    <div class="grid2 mt"><button class="btn block" id="rqChat">${icon('message')}Mesaj</button><button class="btn block" id="rqCall">${icon('phone')}Sună</button></div>
    <div class="offer-actions" style="padding-top:12px"><button class="btn" id="rqNo">Refuz</button><button class="btn go" id="rqYes">${icon('check', { size: 30, stroke: 3 })}ACCEPT</button></div>
  `, { cls: 'req-ov' });
  beep([700, .15, 1000, .2]); vibrate([200, 100, 200]);
  if (settings.voice) speak(`Cerere programată de la ${firstName(ci.name)}, la ora ${fmtTime(o.scheduledFor)}.`);
  $('#rqYes', ov).onclick = () => { bus.act('respondRequest', { orderId: o.id, accept: true }); ov.close(); toast(`Ai acceptat cursa de la ${fmtTime(o.scheduledFor)}. Clientul a fost anunțat.`, 'ok', 3500, 'check'); };
  $('#rqNo', ov).onclick = () => { bus.act('respondRequest', { orderId: o.id, accept: false }); ov.close(); };
  $('#rqChat', ov).onclick = () => { ov.close(); openChat(o); };
  $('#rqCall', ov).onclick = () => { ov.close(); calls.call({ role: 'client', id: phoneKey(o.client.phone), name: o.client.name }, o.id); };
}

// ---------- oferta (comandă nouă) ----------
let offerEl, offerTimer, offerSound, offerMap;
function showOffer(o) {
  closeOffer();
  ui.offerId = o.id;
  const total = (o.offer.until - o.offer.at) / 1000;
  const d = o.dest;
  const ci = clientInfo(bus.state, o.client);
  const car = me();
  offerEl = h(`<div class="offer" role="alertdialog" aria-label="Comandă nouă">
    <div class="offer-head">
      <div class="t">COMANDĂ NOUĂ${o.source === 'telefon' ? '<div class="small muted" style="font-weight:700;letter-spacing:0">prin dispecerat</div>' : o.forceCar || o.requestCar ? '<div class="small" style="font-weight:700;letter-spacing:0;color:var(--to)">clientul te-a ales pe tine</div>' : ''}</div>
      <div class="ring"><svg width="74" height="74"><circle cx="37" cy="37" r="32" stroke="var(--line)" stroke-width="7" fill="none"/><circle id="ringArc" cx="37" cy="37" r="32" stroke="var(--free)" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="201" stroke-dashoffset="0"/></svg><div class="n" id="ringN">${Math.round(total)}</div></div>
    </div>
    <div class="offer-body">
      <div class="client-big">${avatar(ci.name, ci.photo, 60)}<div class="grow"><div style="font-weight:850;font-size:1.2em">${esc(ci.name)}</div><div class="small muted">${ci.rating ? `<span class="stars-s">★</span> ${ci.rating.toLocaleString('ro-RO')} · ` : ''}${ci.rides ? `${ci.rides} curse` : 'Client nou'}</div></div></div>
      ${ci.reviews.length ? `<div class="rev-box">${ci.reviews.slice(0, 2).map(r => `<div class="review"><span class="stars-s">${'★'.repeat(r.stars)}</span> ${esc(r.text)}<div class="who">${esc(r.by)}, șofer</div></div>`).join('')}</div>` : ''}
      <div class="from">
        <div class="lbl">Iei clientul de la</div>
        <div class="addr">${esc(o.pickup.label)}</div>
        <div class="dist">${fmtKm(o.offer.meters)} · ~${o.offer.minutes} min de tine, cu traficul</div>
      </div>
      <div class="offer-map" id="offerMap"></div>
      ${noteBox(o)}
      <div class="to">
        <div class="bubble accent">${icon('flag')}</div>
        <div class="grow"><div class="muted small" style="font-weight:800">DESTINAȚIE</div><div class="addr">${d ? esc(d.label) : 'O spune clientul în mașină'}</div></div>
        ${o.estimate ? `<div class="money">${o.estimate.low}–${o.estimate.high}<span class="small" style="font-weight:700"> lei</span></div>` : ''}
      </div>
      <div class="job-meta">${payTag(o)}${optionTags(o, car)}</div>
    </div>
    <div class="offer-actions">
      <button class="btn" id="refuseBtn">Refuz</button>
      <button class="btn go" id="acceptBtn">${icon('check', { size: 34, stroke: 3 })}ACCEPT</button>
    </div>
  </div>`);
  document.body.append(offerEl);
  // mini-hartă: unde e clientul și drumul până la el
  try {
    offerMap = L.map($('#offerMap', offerEl), { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
    L.tileLayer(darkNow() ? CONFIG.map.tilesDark : CONFIG.map.tiles, { subdomains: 'abcd' }).addTo(offerMap);
    L.polyline(cityMap.roadLines(), { color: darkNow() ? '#3d434e' : '#ddd8cd', weight: 3, interactive: false, renderer: L.canvas() }).addTo(offerMap);
    const r = cityMap.route(carPos(car).p, [o.pickup.lat, o.pickup.lon]);
    L.polyline(r.pts, { color: '#fff', weight: 8 }).addTo(offerMap);
    L.polyline(r.pts, { color: cssVar('--to'), weight: 4.5 }).addTo(offerMap);
    L.marker([o.pickup.lat, o.pickup.lon], { icon: pinIcon('pickup', 'person') }).addTo(offerMap);
    L.circleMarker(carPos(car).p, { radius: 8, color: '#fff', weight: 3, fillColor: cssVar('--free'), fillOpacity: 1 }).addTo(offerMap);
    offerMap.fitBounds(L.latLngBounds(r.pts).pad(0.25), { maxZoom: 17 });
  } catch { /* fără mini-hartă */ }
  $('#acceptBtn', offerEl).onclick = () => { bus.act('accept', { orderId: o.id, carId: ME }); ui.follow = true; ui.nearAnnounced = null; closeOffer(); beep([660, .1, 990, .14]); };
  $('#refuseBtn', offerEl).onclick = () => { bus.act('refuse', { orderId: o.id, carId: ME }); closeOffer(); };
  const tickOffer = () => {
    const left = Math.max(0, (o.offer.until - Date.now()) / 1000);
    const n = $('#ringN', offerEl), arc = $('#ringArc', offerEl);
    if (n) n.textContent = Math.ceil(left);
    if (arc) { arc.setAttribute('stroke-dashoffset', String(201 * (1 - left / total))); arc.setAttribute('stroke', left < 8 ? 'var(--danger)' : 'var(--free)'); }
  };
  tickOffer();
  offerTimer = setInterval(tickOffer, 200);
  const ring = () => { beep([880, .14, 1320, .14, 1760, .2], .25); vibrate([300, 120, 300]); };
  ring(); offerSound = setInterval(ring, 3500);
  if (settings.voice) setTimeout(() => speak(`Comandă nouă. ${o.pickup.label}. ${o.offer.minutes} minute până la client.${o.note ? ' Indicații: ' + o.note + '.' : ''}${o.payment === 'card' ? ' Plată cu cardul.' : ''}`), 600);
}
function closeOffer() {
  clearInterval(offerTimer); clearInterval(offerSound);
  if (offerMap) { try { offerMap.remove(); } catch {} offerMap = null; }
  if (offerEl) { offerEl.remove(); offerEl = null; }
  ui.offerId = null;
  try { speechSynthesis.cancel(); } catch {}
}

// ---------- taximetru / sumă ----------
function openMeter(o) {
  const suggested = bus.sim.computeFare(o);
  let digits = String(Math.round(suggested * 100));
  const ov = modal(`
    <div class="panel-head"><h2>Suma de pe taximetru</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin:-6px 0 0">Verifică suma și apasă Confirmă. ${o.payment === 'card' ? 'Se încasează automat de pe cardul clientului.' : 'Clientul plătește cash.'}</p>
    <div class="amount" id="amt"></div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="c" style="font-size:1em">Șterge</button><button data-k="0">0</button><button data-k="b">${icon('back', { size: 28 })}</button></div>
    <button class="btn go step block" id="meterOk">CONFIRMĂ</button>
  `);
  const draw = () => { const v = (+digits || 0) / 100; $('#amt', ov).textContent = fmtMoney(v) + ' lei'; };
  draw();
  $$('[data-k]', ov).forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'c') digits = ''; else if (k === 'b') digits = digits.slice(0, -1); else if (digits.length < 6) digits += k;
    draw();
  });
  $('#meterOk', ov).onclick = () => {
    const fare = (+digits || 0) / 100;
    if (fare < T.minFare) { toast(`Suma minimă este ${fmtMoney(T.minFare)} lei.`, 'warn'); return; }
    ov.close();
    ui.finishing = o.id; ui.finishFare = fare;
    bus.act('finish', { orderId: o.id, fare });
    if (o.payment === 'card') { beep([990, .1, 1320, .18]); if (settings.voice) speak(`Plata de ${Math.round(fare)} lei s-a încasat automat de pe card.`); }
  };
}

// ---------- navigare, mesaje ----------
function openNav(o) {
  const t = o.status === 'in_cursa' ? (o.dest || o.destInCar) : o.pickup;
  if (!t) return;
  const links = navLinks(t.lat, t.lon);
  if (settings.navAsk === false) { open(links[settings.nav], '_blank'); return; }
  const ov = modal(`
    <div class="panel-head"><h2>Navighează cu</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="vstack">
      <a class="btn dark block xl" href="${links.waze}" target="_blank" rel="noopener" data-n="waze">Waze</a>
      <a class="btn block xl" href="${links.google}" target="_blank" rel="noopener" data-n="google">Google Maps</a>
    </div>
    <label class="hstack mt" style="font-weight:650;min-height:48px"><input type="checkbox" id="navRemember" style="width:24px;height:24px"> Ține minte alegerea</label>
  `);
  $$('[data-n]', ov).forEach(a => a.onclick = () => { if ($('#navRemember', ov).checked) { settings.nav = a.dataset.n; settings.navAsk = false; saveSettings(); } setTimeout(() => ov.close(), 100); });
}

function openChat(o) {
  const quick = ['Am ajuns, vă aștept', 'Ajung în 2 minute', 'Sunt în fața blocului', 'Nu găsesc adresa, vă rog sunați-mă', 'Sunt în trafic, întârzii puțin', 'Mai am 5 minute de pauză'];
  const ci = clientInfo(bus.state, o.client);
  const ov = modal(`
    <div class="panel-head">${avatar(ci.name, ci.photo, 40)}<h2>${esc(firstName(ci.name))}</h2><button class="icon-btn flat" id="chCall" aria-label="Sună">${icon('phone')}</button><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="chat" id="chatList"></div>
    <div class="quick-list">${quick.map(q => `<button class="btn block" style="justify-content:flex-start" data-q="${esc(q)}">${icon('message', { size: 20 })}${esc(q)}</button>`).join('')}</div>
    <div class="hstack mt"><input class="input" id="chatIn" placeholder="Scrie un mesaj…"><button class="icon-btn" style="background:var(--ink);color:var(--bg);width:60px;height:60px" id="chatSend" aria-label="Trimite">${icon('nav')}</button></div>
  `, { cls: 'chat-ov', onClose: () => unsub() });
  const draw = () => {
    const msgs = bus.state.chats[o.id] || [];
    $('#chatList', ov).innerHTML = msgs.map(m => `<div class="msg ${m.from === 'sofer' ? 'me' : 'them'}">${esc(m.text)}<div class="tm">${fmtTime(m.t)}</div></div>`).join('') || '<p class="muted center" style="margin:0">Niciun mesaj încă.</p>';
    $('#chatList', ov).scrollTop = 1e6;
    ui.chatSeen[o.id] = msgs.filter(m => m.from !== 'sofer').length;
  };
  const unsub = bus.on(draw);
  const send = t => { if (!t.trim()) return; bus.act('message', { orderId: o.id, from: 'sofer', text: t.trim() }); };
  $$('[data-q]', ov).forEach(b => b.onclick = () => { send(b.dataset.q); toast('Trimis', 'ok', 1500, 'check'); });
  $('#chatSend', ov).onclick = () => { send($('#chatIn', ov).value); $('#chatIn', ov).value = ''; };
  $('#chatIn', ov).onkeydown = e => { if (e.key === 'Enter') $('#chatSend', ov).click(); };
  $('#chCall', ov).onclick = () => calls.call({ role: 'client', id: phoneKey(o.client.phone), name: o.client.name }, o.id);
}

// ---------- stații, precomenzi ----------
function openStations() {
  const car = me(); const p = carPos(car).p;
  const rows = CONFIG.stations.map(s => ({ s, d: dist(p, [s.lat, s.lon]), n: stationQueue(bus.state, s.id).length })).sort((a, b) => a.d - b.d);
  const ov = modal(`
    <div class="panel-head"><h2>Stații de taxi</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin-top:-6px">Alege unde vrei să aștepți. Mașina ta intră automat la rând când ajungi.</p>
    ${rows.map(r => `<button class="row" data-s="${r.s.id}"><span class="bubble" style="background:${r.n ? 'var(--free-soft)' : 'var(--surface-2)'};color:${r.n ? 'var(--free)' : 'var(--muted)'};font-weight:900">${r.n}</span><span class="grow"><div class="t">${esc(r.s.name)}</div><div class="s">${esc(r.s.hint)} · ${fmtKm(r.d)}</div></span>${icon('chevron', { cls: 'muted' })}</button>`).join('')}
  `);
  $$('[data-s]', ov).forEach(b => b.onclick = () => { bus.act('goStation', { carId: ME, stationId: b.dataset.s }); ov.close(); ui.follow = true; toast('Pornește spre stație. Te punem la rând automat.', 'ok', 3000, 'nav'); });
}

function openPreorders() {
  const all = bus.state.orders.filter(x => x.status === 'programata').sort((a, b) => a.scheduledFor - b.scheduledFor);
  const mine = all.filter(o => o.reservedBy === ME);
  const free = all.filter(o => !o.reservedBy && !(o.request && o.request.status === 'pending'));
  const car = me();
  const row = (o, btn) => `<div class="pre-item"><div class="up-time">${fmtTime(o.scheduledFor)}<small>${sameDay(o.scheduledFor) ? 'azi' : dayShort(o.scheduledFor)}</small></div><div class="grow"><b>${esc(o.pickup.label)}</b><div class="small muted">${o.dest ? 'spre ' + esc(o.dest.label) : 'destinație în mașină'}${o.estimate ? ` · ${o.estimate.low}–${o.estimate.high} lei` : ''}</div>${reqOptions(o.options).length ? `<div class="job-meta" style="margin:6px 0 0">${optionTags(o, car)}</div>` : ''}</div>${btn}</div>`;
  const ov = modal(`
    <div class="panel-head"><h2>Precomenzi</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin-top:-6px">Preia o cursă din timp: în ziua respectivă o primești automat și clientul știe că vii tu.</p>
    ${mine.length ? `<h3>Rezervate de tine</h3>${mine.map(o => row(o, `<button class="btn sm" data-un="${o.id}">Renunț</button>`)).join('')}` : ''}
    <h3>Disponibile</h3>
    ${free.length ? free.map(o => row(o, `<button class="btn sm go" data-res="${o.id}">Preiau eu</button>`)).join('') : '<p class="muted center" style="padding:20px 0">Nu sunt precomenzi libere acum.</p>'}
  `);
  $$('[data-res]', ov).forEach(b => b.onclick = () => { bus.act('reserve', { orderId: b.dataset.res, carId: ME }); ov.close(); toast('Ai preluat cursa. Clientul a fost anunțat.', 'ok', 3000, 'calendar'); });
  $$('[data-un]', ov).forEach(b => b.onclick = () => { bus.act('unreserve', { orderId: b.dataset.un }); ov.close(); toast('Ai renunțat la cursă. Va fi preluată de alt șofer.', '', 3000); });
}

// ---------- meniu ----------
function openMenu() {
  const car = me();
  const today = bus.state.orders.filter(o => o.carId === ME && o.status === 'finalizata').sort((a, b) => b.finishedAt - a.finishedAt);
  const dms = bus.state.driverMsgs.filter(m => m.to === ME || m.to === 'toti' || m.from === ME).slice(-10).reverse();
  const req = pendingRequests();
  const ov = modal(`
    <div class="menu-head" style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <button class="ph-btn" id="mPhoto" aria-label="Schimbă poza">${avatar(car.driver, car.photo, 62)}<span class="ph-edit">${icon('plus', { size: 14 })}</span></button>
      <div class="grow"><div style="font-weight:850;font-size:1.15em">${esc(car.driver)}</div><div class="muted">Indicativ ${car.cs} · ${esc(car.plate)}</div><div class="small"><span class="stars-s">★</span> ${car.rating.toLocaleString('ro-RO')}</div></div>
      <button class="icon-btn flat" data-close>${icon('close')}</button>
    </div>
    <div class="grid3 mb">
      <div class="stat"><div class="k">Cash azi</div><div class="v">${Math.round(car.earnings.cash)}</div></div>
      <div class="stat"><div class="k">Card azi</div><div class="v">${Math.round(car.earnings.card)}</div></div>
      <div class="stat"><div class="k">Bacșiș</div><div class="v">${Math.round(car.earnings.tips || 0)}</div></div>
    </div>
    ${req.length ? `<button class="row" id="mReq"><span class="bubble" style="background:var(--to-soft);color:var(--to)">${icon('calendar')}</span><span class="grow"><div class="t">Cereri programate</div><div class="s">${req.length} așteaptă răspunsul tău</div></span>${icon('chevron', { cls: 'muted' })}</button>` : ''}
    <button class="row" id="mHist"><span class="bubble">${icon('history')}</span><span class="grow"><div class="t">Cursele de azi</div><div class="s">${today.length} în aplicație</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mRev"><span class="bubble">${icon('star')}</span><span class="grow"><div class="t">Recenziile mele</div><div class="s">${car.reviews.length} recenzii · ★ ${car.rating.toLocaleString('ro-RO')}</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mDm"><span class="bubble accent">${icon('headset')}</span><span class="grow"><div class="t">Mesaje dispecerat</div><div class="s">${dms.length ? esc(dms[0].text) : 'Niciun mesaj'}</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <div class="row"><span class="bubble">${icon('moon')}</span><span class="grow"><div class="t">Mod noapte</div><div class="s">Ecran întunecat, nu te orbește noaptea</div></span>
      <select class="input" id="mTheme" style="width:auto;min-height:48px"><option value="auto">Automat</option><option value="dark">Pornit</option><option value="light">Oprit</option></select></div>
    <div class="row"><span class="bubble">${icon('volume')}</span><span class="grow"><div class="t">Citește comenzile cu voce</div><div class="s">Nu mai trebuie să te uiți la telefon</div></span><button class="toggle ${settings.voice ? 'on' : ''}" id="mVoice" aria-label="Voce"></button></div>
    <div class="row"><span class="bubble">${icon('text')}</span><span class="grow"><div class="t">Text mare</div></span><button class="toggle ${settings.big ? 'on' : ''}" id="mBig" aria-label="Text mare"></button></div>
    <div class="row"><span class="bubble">${icon('nav')}</span><span class="grow"><div class="t">Navigație</div></span>
      <select class="input" id="mNav" style="width:auto;min-height:48px"><option value="ask">Întreabă</option><option value="waze">Waze</option><option value="google">Google Maps</option></select></div>
    <button class="row" id="mCallD"><span class="bubble accent">${icon('phone')}</span><span class="grow"><div class="t">Sună dispeceratul</div><div class="s">${esc(CONFIG.company.dispatchPhone)}</div></span></button>
    <button class="row" id="mOut"><span class="bubble">${icon('logout')}</span><span class="grow t">Închide tura</span></button>
  `);
  $('#mTheme', ov).value = settings.theme;
  $('#mNav', ov).value = settings.navAsk === false ? settings.nav : 'ask';
  $('#mPhoto', ov).onclick = async () => { const ph = await pickPhoto(); if (!ph) return; bus.act('setPhoto', { role: 'sofer', carId: ME, photo: ph }); ov.close(); toast('Poza a fost salvată. Clienții o văd când accepți o cursă.', 'ok', 3000, 'check'); };
  $('#mTheme', ov).onchange = e => { settings.theme = e.target.value; saveSettings(); applyTheme(darkNow()); map.setDark(darkNow()); ui.lastKey = ''; render(); };
  $('#mNav', ov).onchange = e => { if (e.target.value === 'ask') settings.navAsk = true; else { settings.nav = e.target.value; settings.navAsk = false; } saveSettings(); };
  $('#mVoice', ov).onclick = e => { settings.voice = !settings.voice; saveSettings(); e.currentTarget.classList.toggle('on', settings.voice); if (settings.voice) speak('Comenzile vor fi citite cu voce.'); };
  $('#mBig', ov).onclick = e => { settings.big = !settings.big; saveSettings(); applyTextSize(settings.big); e.currentTarget.classList.toggle('on', settings.big); };
  const mr = $('#mReq', ov); if (mr) mr.onclick = () => { ov.close(); showRequest(req[0]); };
  $('#mCallD', ov).onclick = () => { ov.close(); calls.call({ role: 'dispecer', id: 'dispecer', name: 'Dispecerat' }); };
  $('#mHist', ov).onclick = () => {
    ov.close();
    modal(`<div class="panel-head"><h2>Cursele de azi</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
      ${today.length ? today.map(o => `<div class="row"><span class="bubble">${icon(o.payment === 'card' ? 'card' : 'cash')}</span><span class="grow"><div class="t">${esc((o.dest || o.destInCar || {}).label || o.pickup.label)}</div><div class="s">${fmtTime(o.finishedAt)} · ${esc(firstName(o.client.name))}${o.review ? ` · ${'★'.repeat(o.review.stars)}` : ''}${o.tip ? ` · bacșiș ${fmtMoney(o.tip.amount)}` : ''}</div></span><b>${fmtMoney(o.fare)}</b></div>`).join('') : '<p class="muted center" style="padding:24px 0">Nicio cursă prin aplicație azi.</p>'}`);
  };
  $('#mRev', ov).onclick = () => {
    ov.close();
    modal(`<div class="panel-head"><h2>Recenziile mele</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
      ${car.reviews.map(r => `<div class="review"><span class="stars-s">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span> ${esc(r.text || '')}<div class="who">${esc(r.by)} · ${new Date(r.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}</div></div>`).join('')}`);
  };
  $('#mDm', ov).onclick = () => {
    ov.close();
    const m2 = modal(`<div class="panel-head"><h2>Mesaje dispecerat</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
      <div class="chat">${dms.slice().reverse().map(m => `<div class="msg ${m.from === ME ? 'me' : 'them'}">${esc(m.text)}<div class="tm">${fmtTime(m.t)}${m.to === 'toti' ? ' · către toți' : ''}</div></div>`).join('') || '<p class="muted center">Niciun mesaj.</p>'}</div>
      <div class="quick-list">${['Am înțeles', 'Sunt în drum spre stație', 'Am o problemă cu mașina', 'Vă sun imediat'].map(q => `<button class="btn block" style="justify-content:flex-start" data-r="${q}">${icon('message', { size: 20 })}${q}</button>`).join('')}</div>`);
    $$('[data-r]', m2).forEach(b => b.onclick = () => { bus.act('driverMsg', { from: ME, carId: 'dispecer', text: b.dataset.r }); m2.close(); toast('Trimis dispeceratului', 'ok', 1500, 'check'); });
  };
  $('#mOut', ov).onclick = async () => {
    if (me().orderId) { toast('Termină întâi cursa în desfășurare.', 'warn'); return; }
    if (await confirmBox('Închizi tura?', 'Nu vei mai primi comenzi până intri din nou.', { yes: 'Închide tura' })) {
      ui.loggingOut = true; bus.act('driverLogout', { carId: ME }); store.set('driver-session', null); session = null; ov.close(); showLogin();
    }
  };
}

// ---------- SOS: ține apăsat 2 secunde ----------
function setupSos() {
  const b = $('#sosBtn'); let t;
  const start = e => { e.preventDefault(); b.classList.add('holding'); vibrate(40); t = setTimeout(fire, 2000); };
  const stop = () => { b.classList.remove('holding'); clearTimeout(t); };
  const fire = () => {
    stop(); vibrate([400, 100, 400]); bus.act('sos', { carId: ME });
    modal(`<div class="center" style="padding:8px 0">
      <div class="bubble" style="margin:0 auto 12px;width:80px;height:80px;border-radius:24px;background:var(--danger);color:#fff">${icon('shield', { size: 40 })}</div>
      <h2 style="margin:0 0 6px">Dispeceratul a fost alertat</h2><p class="muted" style="margin:0 0 16px">Locația ta a fost trimisă și dispeceratul aude ce se întâmplă în mașină. Rămâi calm, vei fi contactat imediat.</p>
      <div class="btn block xl" style="cursor:default">${icon('phone')}Urgență: <b>112</b></div><button class="btn ghost block mt" data-close>Închide</button></div>`);
  };
  b.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stop));
  b.addEventListener('click', () => { if (!b.classList.contains('holding')) toast('Pentru SOS, ține apăsat butonul 2 secunde.', '', 2500, 'shield'); });
}

// ---------- intrarea în tură ----------
function showLogin() {
  const f = CONFIG.fleet[humanFleetIdx];
  let pin = '';
  const el = h(`<div class="login"><div class="login-inner">
    <div class="center"><div class="boot-logo" style="margin:10px auto 14px;animation:none">${icon('car', { size: 34 })}</div>
    <h1 style="margin:0;font-size:1.5em">${esc(CONFIG.company.name)} · Șofer</h1>
    <p class="muted" style="margin:6px 0 16px">Intră în tură ca să primești comenzi.</p></div>
    <div class="car-card" style="display:flex;align-items:center;gap:14px;padding:14px;border-radius:18px;background:var(--surface)">
      ${avatar(f.driver, (me() || {}).photo, 56)}
      <div class="grow"><div style="font-weight:850">${esc(f.driver)}</div><div class="muted small">Indicativ ${f.cs} · ${esc(f.model)} · ${esc(f.plate)}</div></div>
    </div>
    <p class="center" style="font-weight:750;margin:18px 0 0">Codul PIN <span class="muted small">(demo: 1234)</span></p>
    <div class="pin-dots">${[0, 1, 2, 3].map(i => `<span data-d="${i}"></span>`).join('')}</div>
    <div class="keypad" style="max-width:360px;margin:12px auto">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="fill" style="font-size:.7em">Demo</button><button data-k="0">0</button><button data-k="b">${icon('back', { size: 28 })}</button></div>
    <button class="btn go step block" id="goShift" disabled>${icon('play', { size: 28 })}INTRĂ ÎN TURĂ</button>
  </div></div>`);
  document.body.append(el);
  const draw = () => { $$('[data-d]', el).forEach((d, i) => d.classList.toggle('on', i < pin.length)); $('#goShift', el).disabled = pin.length < 4; };
  $$('[data-k]', el).forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'b') pin = pin.slice(0, -1); else if (k === 'fill') pin = '1234'; else if (pin.length < 4) pin += k;
    draw();
  });
  $('#goShift', el).onclick = () => {
    if (pin !== '1234') { toast('PIN greșit. În demo, PIN-ul este 1234.', 'bad'); pin = ''; draw(); return; }
    session = { carId: ME, t: Date.now() }; store.set('driver-session', session);
    ui.loggingOut = false;
    bus.act('driverLogin', { carId: ME });
    el.remove(); ui.lastKey = ''; ui.follow = true;
    beep([660, .1, 990, .15]);
    if (settings.voice) speak('Bună ziua! Ești în tură. Comenzile vor fi citite cu voce.');
    setTimeout(() => { render(); followMe(true); }, 200);
  };
}

let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { map.invalidateSize(); followMe(true); }, 150); });

// ---------- pornire ----------
bus.on(onState);
boot.done();
if (!session) showLogin();
setInterval(() => { const d = darkNow(); if ((document.documentElement.dataset.theme === 'dark') !== d) { applyTheme(d); map.setDark(d); ui.lastKey = ''; render(); } }, 60000);
