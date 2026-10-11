// Panoul DISPECERAT – vede toată flota, preia apeluri, alocă, comunică cu șoferii, gestionează incidente.
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, carCategory, colorCat, CATEGORY_LABEL, ORDER_LABEL, stationQueue, etaSeconds, remainingRoute, estimateFare, uid, STATUS, reqOptions, carHas, optionLabel, carCapsList, pauseLeft, phoneKey, clientInfo } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, TrafficLayer, cssVar, carSvg, CAR_COLOR } from './mapview.js';
import { icon } from './icons.js';
import { mountCalls } from './calls.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtMoney, fmtClock, beep, store, loadingScreen, unlockAudio, firstName } from './ui.js';

const L = window.L;
const boot = loadingScreen('Pornim dispeceratul…');
unlockAudio();
document.title = 'Dispecerat · ' + CONFIG.company.name;

let cityMap, bus, map, fleet, route, traffic, calls;
const ui = {
  tab: 'comenzi', selOrder: null, selCar: null, follow: null, q: '',
  filters: new Set(['liber', 'spre_client', 'cu_client', 'pauza']),
  picking: null, form: { pickup: null, dest: null }, seenAlerts: new Set(), smsSent: new Set(), lastLists: '',
  incoming: null, seenDriverMsgs: 0, msgTo: 'toti',
};

try { cityMap = await CityMap.load(); } catch (e) { boot.fail('Nu am putut încărca harta.'); throw e; }

document.body.innerHTML = `
<div class="dwrap">
  <header class="dhead">
    <div class="dbrand"><span class="logo">${icon('headset', { size: 20 })}</span>${esc(CONFIG.company.name)} · Dispecerat</div>
    <div class="kpis" id="kpis"></div>
    <div class="demo-ctl">
      <span class="lbl">Demo</span>
      <button class="btn sm" id="simCall" title="Simulează un apel de la un client">${icon('phone', { size: 18 })}<span>Apel test</span></button>
      <div class="segs" id="speed">${[1, 2, 5, 10].map(m => `<button data-m="${m}">x${m}</button>`).join('')}</div>
      <button class="btn sm" id="bgBtn" title="Comenzi automate în oraș">${icon('refresh', { size: 18 })}<span>Trafic</span></button>
      <button class="btn sm ghost" id="resetBtn" title="Repornește demo-ul">Reset</button>
      <span class="clock" id="clock"></span>
    </div>
  </header>
  <div class="dbody">
    <aside class="dcol left">
      <div id="sosBox"></div>
      <div id="callBox"></div>
      <div class="dsec" id="alertsSec" hidden><h3>${icon('alert', { size: 16 })}Alerte <span class="count" id="alertCount">0</span><button class="btn sm ghost" id="ackAll" style="margin-left:auto;min-height:30px;padding:0 10px">Șterge tot</button></h3><div id="alerts"></div></div>
      <div class="dsec">
        <h3>${icon('phone', { size: 16 })}Comandă telefonică <span class="kbd" title="Scurtătură">F2</span></h3>
        <form id="phoneForm" autocomplete="off">
          <div class="f2">
            <label class="dfield"><span>Telefon client</span><input class="input" id="fPhone" inputmode="tel" placeholder="07xx xxx xxx"></label>
            <label class="dfield"><span>Nume</span><input class="input" id="fName" placeholder="Nume client"></label>
          </div>
          <div id="known"></div>
          <label class="dfield"><span>Adresa de preluare <button type="button" class="pill" id="pickMapBtn" style="border:0;cursor:pointer;float:right">${icon('pin', { size: 14 })}pe hartă</button></span><input class="input" id="fPickup" placeholder="Stradă, număr sau loc cunoscut"><div class="ac" id="acPickup" hidden></div></label>
          <label class="dfield"><span>Destinație (opțional) <button type="button" class="pill" id="destMapBtn" style="border:0;cursor:pointer;float:right">${icon('pin', { size: 14 })}pe hartă</button></span><input class="input" id="fDest" placeholder="Unde merge clientul"><div class="ac" id="acDest" hidden></div></label>
          <div class="mini-opts">
            ${CONFIG.options.map(o => `<label><input type="checkbox" data-o="${o.key}">${o.short}</label>`).join('')}
            <label class="urg"><input type="checkbox" id="fUrgent">Urgent</label>
          </div>
          <label class="dfield"><span>Reper / mesaj pentru șofer</span><input class="input" id="fNote" placeholder="ex. scara 2, lângă farmacie"></label>
          <div class="dfield"><span>Programare (lasă ora goală pentru „acum”)</span><div class="f2"><input class="input" id="fDay" type="date" aria-label="Ziua"><input class="input" id="fWhen" type="time" aria-label="Ora"></div></div>
          <div id="fEst" class="small muted" style="margin:-2px 0 10px"></div>
          <div class="f2">
            <button class="btn primary block" type="submit">${icon('car', { size: 20 })}Trimite</button>
            <button class="btn dark block" type="button" id="pickCarBtn">Alege mașina</button>
          </div>
        </form>
      </div>
      <div class="dsec">
        <h3>${icon('stand', { size: 16 })}Stații</h3>
        <div id="stations"></div>
      </div>
    </aside>
    <main class="dmap" id="dmap">
      <div id="map" class="map"></div>
      <div class="map-filters" id="filters"></div>
      <div class="map-hint" id="mapHint" hidden></div>
    </main>
    <aside class="dcol right">
      <div class="search-wrap"><span class="ic-s">${icon('search', { size: 18 })}</span><input class="input" id="search" placeholder="Caută: telefon, indicativ, număr, adresă…"></div>
      <div class="tabs" id="tabs">
        <button data-t="comenzi">Comenzi <span class="count" id="cntO">0</span></button>
        <button data-t="precomenzi">Precomenzi <span class="count" id="cntP">0</span></button>
        <button data-t="masini">Mașini <span class="count" id="cntC">0</span></button>
        <button data-t="mesaje">Mesaje <span class="count" id="cntM" hidden>0</span></button>
        <button data-t="istoric">Istoric</button>
      </div>
      <div id="detail"></div>
      <div class="tabbody" id="list"></div>
    </aside>
  </div>
</div>
<div class="demo-badge" style="top:auto;bottom:10px">DEMO</div>`;

map = createMap($('#map'), { cityMap, zoom: 14 });
traffic = new TrafficLayer(map, cityMap);
route = new RouteLine(map);
bus = await connect(cityMap, { role: 'dispecer' });
window.taxiDemo = bus;
fleet = new FleetLayer(map, {
  filter: c => c.status !== STATUS.offline && ui.filters.has(colorCat(c)),
  selected: () => ui.selCar || (ui.selOrder && orderById(ui.selOrder)?.carId),
  tag: c => String(c.cs),
  onCar: id => selectCar(id),
  onStation: s => { map.setView([s.lat, s.lon], 16); },
  onFrame: frame,
});
const orderLayer = L.layerGroup().addTo(map);
const sosLayer = L.layerGroup().addTo(map);
let formPickupMk, formDestMk;
calls = mountCalls(bus, { role: 'dispecer', id: () => 'dispecer', name: () => 'Dispecerat' }, {
  label: p => p.role === 'sofer' ? `${(carById(p.id) || {}).driver} · ${(carById(p.id) || {}).cs}` : p.role === 'client' ? clientInfo(bus.state, { phone: p.id }).name + ' · client' : p.name,
  photo: p => p.role === 'sofer' ? (carById(p.id) || {}).photo : p.role === 'client' ? clientInfo(bus.state, { phone: p.id }).photo : null,
});

// ---------- antet ----------
$$('#speed button').forEach(b => b.onclick = () => bus.act('setSpeed', { mul: +b.dataset.m }));
$('#bgBtn').onclick = () => bus.act('setFlag', { key: 'bgOrders', value: !bus.state.bgOrders });
$('#resetBtn').onclick = async () => { if (await confirmBox('Repornești demo-ul?', 'Toate comenzile și cursele de azi se șterg. Șoferul din aplicație trebuie să intre din nou în tură.', { yes: 'Repornește', danger: true })) { bus.act('reset'); toast('Demo repornit', 'ok'); } };
$('#simCall').onclick = () => simulateIncoming(true);
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);
$$('#tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.t; ui.lastLists = ''; renderLists(); });
$('#ackAll').onclick = () => bus.act('ackAll');
$('#search').oninput = e => { ui.q = e.target.value.trim(); if (ui.q && ui.tab === 'mesaje') ui.tab = 'comenzi'; ui.lastLists = ''; renderLists(); };
addEventListener('keydown', e => {
  if (e.key === 'F2') { e.preventDefault(); $('#fPhone').focus(); }
  if (e.key === 'Escape') { stopPick(); if (ui.selOrder || ui.selCar) { ui.selOrder = ui.selCar = null; ui.lastLists = ''; renderLists(); renderDetail(); } }
});

// ---------- filtre hartă ----------
function renderFilters(counts) {
  const items = [['liber', 'Liber'], ['spre_client', 'Merge la comandă'], ['cu_client', 'Cu client'], ['pauza', 'Pauză']];
  const html = items.map(([k, l]) => `<button class="pill ${ui.filters.has(k) ? '' : 'off'}" data-f="${k}"><span class="lg-car ${k}">${carSvg(k, 18)}</span>${l} <b>${counts[k] || 0}</b></button>`).join('')
    + `<button class="pill ${traffic.on ? 'tr-on' : 'off'}" id="trBtn">${icon('gauge', { size: 16 })}Trafic</button>`;
  const box = $('#filters');
  if (box.dataset.h === html) return;
  box.dataset.h = html; box.innerHTML = html;
  $$('#filters [data-f]').forEach(b => b.onclick = () => { const k = b.dataset.f; ui.filters.has(k) ? ui.filters.delete(k) : ui.filters.add(k); fleet.update(bus.state); box.dataset.h = ''; renderFilters(counts); });
  $('#trBtn').onclick = () => { traffic.show(!traffic.on); box.dataset.h = ''; renderFilters(counts); };
}

// ---------- stare ----------
const orderById = id => bus.state.orders.find(o => o.id === id);
const carById = id => bus.state.cars.find(c => c.id === id);
const carTag = c => c ? `<span class="no" style="background:${CAR_COLOR[colorCat(c)]}">${c.cs}</span>` : '';

function onState(state) {
  if (!state) return;
  fleet.update(state);
  traffic.refresh();
  $$('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.m === state.speedMul));
  $('#bgBtn').classList.toggle('dark', state.bgOrders);
  const counts = {};
  for (const c of state.cars) { if (c.status === STATUS.offline) continue; const k = colorCat(c); counts[k] = (counts[k] || 0) + 1; }
  renderFilters(counts);
  renderKpis(state, counts);
  renderSos(state);
  renderAlerts(state);
  renderStations(state);
  renderOrderPins(state);
  renderLists();
  renderDetail();
  smsNotices(state);
  driverMsgNotices(state);
}

function renderKpis(state, counts) {
  const online = state.cars.filter(c => c.status !== STATUS.offline).length;
  const rides = state.cars.reduce((a, c) => a + c.earnings.rides, 0);
  const revenue = state.cars.reduce((a, c) => a + c.earnings.cash + c.earnings.card, 0);
  const waits = state.orders.filter(o => o.arrivedAt && o.source !== 'fundal').map(o => (o.arrivedAt - o.createdAt) / 60000 * state.speedMul);
  const waiting = state.orders.filter(o => ['cautare', 'oferita'].includes(o.status)).length;
  const sched = state.orders.filter(o => o.status === 'programata').length;
  const html = `
    <div class="kpi"><div class="k">În tură</div><div class="v">${online}<span class="small muted">/${state.cars.length}</span></div></div>
    <div class="kpi"><div class="k">Libere</div><div class="v"><span class="sw" style="background:var(--free)"></span>${counts.liber || 0}</div></div>
    <div class="kpi"><div class="k">Spre comandă</div><div class="v"><span class="sw" style="background:var(--to)"></span>${counts.spre_client || 0}</div></div>
    <div class="kpi"><div class="k">Cu client</div><div class="v"><span class="sw" style="background:var(--busy)"></span>${counts.cu_client || 0}</div></div>
    <div class="kpi ${waiting ? 'hot' : ''}"><div class="k">Așteaptă șofer</div><div class="v">${waiting}</div></div>
    <div class="kpi"><div class="k">Programate</div><div class="v">${sched}</div></div>
    <div class="kpi"><div class="k">Curse azi</div><div class="v">${rides}</div></div>
    <div class="kpi"><div class="k">Încasări azi</div><div class="v">${Math.round(revenue).toLocaleString('ro-RO')} lei</div></div>
    ${waits.length ? `<div class="kpi"><div class="k">Sosire medie</div><div class="v">${Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)} min</div></div>` : ''}`;
  if ($('#kpis').dataset.h !== html) { $('#kpis').innerHTML = html; $('#kpis').dataset.h = html; }
}

// ---------- incidente SOS (cu audio live din mașină) ----------
let sosKey = '';
function renderSos(state) {
  const list = state.alerts.filter(a => a.kind === 'sos' && !a.ack);
  sosLayer.clearLayers();
  for (const a of list) { const c = carById(a.carId); const p = c ? carPos(c).p : [a.lat, a.lon]; L.marker(p, { icon: pinIcon('sos', 'shield'), zIndexOffset: 5000 }).addTo(sosLayer); }
  const key = list.map(a => a.id).join(',');
  if (key === sosKey) return;
  sosKey = key;
  $('#sosBox').innerHTML = list.map(a => {
    const c = carById(a.carId); const o = a.orderId ? orderById(a.orderId) : (c && c.orderId ? orderById(c.orderId) : null);
    return `<div class="sos-card" data-sos="${a.id}">
      <div class="sos-h">${icon('shield', { size: 22 })}<b>SOS ${a.by === 'client' ? 'de la client' : 'de la șofer'}</b><span class="tm">${fmtTime(a.t)}</span></div>
      ${c ? `<div class="sos-car">${carTag(c)}<div class="grow"><b>${esc(c.driver)}</b> · ${esc(c.plate)}<div class="small">${o ? `Comanda #${o.code} · ${esc(o.client.name)} · ${esc(o.client.phone)}` : 'Fără comandă activă'}</div></div></div>` : ''}
      <div class="audio"><span class="rec-dot"></span><b>Audio live din mașină</b><span class="small" data-rec-t="${c ? c.recordingSince || a.t : a.t}">0:00</span><div class="wave">${'<i></i>'.repeat(28)}</div></div>
      <div class="small" style="opacity:.8;margin:-2px 0 8px">În demo sunetul e simulat. În producție, telefonul șoferului transmite audio criptat doar către dispecerat.</div>
      <div class="sos-btns">
        <button class="btn sm" data-follow="${a.carId || ''}">${icon('locate', { size: 16 })}Urmărește</button>
        ${c ? `<button class="btn sm" data-calldrv="${c.id}">${icon('phone', { size: 16 })}Șofer</button>` : ''}
        ${o ? `<button class="btn sm" data-callcl="${o.id}">${icon('phone', { size: 16 })}Client</button>` : ''}
        <span class="btn sm" style="cursor:default">112</span>
        <button class="btn sm dark" data-resolve="${a.carId || ''}" data-aid="${a.id}">${icon('check', { size: 16 })}Rezolvat</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-follow]').forEach(b => b.onclick = () => { ui.follow = b.dataset.follow || null; const c = carById(ui.follow); if (c) map.setView(carPos(c).p, 17); toast('Harta urmărește mașina', '', 1800, 'locate'); });
  $$('[data-calldrv]').forEach(b => b.onclick = () => { const c = carById(b.dataset.calldrv); calls.call({ role: 'sofer', id: c.id, name: c.driver }); });
  $$('[data-callcl]').forEach(b => b.onclick = () => { const o = orderById(b.dataset.callcl); calls.call({ role: 'client', id: phoneKey(o.client.phone), name: o.client.name }, o.id); });
  $$('[data-resolve]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Închizi incidentul?', 'Înregistrarea audio se oprește și alerta dispare.', { yes: 'Da, e rezolvat' }))) return;
    if (b.dataset.resolve) bus.act('resolveSos', { carId: b.dataset.resolve }); else bus.act('ackAlert', { id: b.dataset.aid });
    ui.follow = null;
  });
}
setInterval(() => {
  $$('.sos-card .wave i').forEach(i => { i.style.height = (12 + Math.random() * 88) + '%'; });
  $$('[data-rec-t]').forEach(el => { el.textContent = fmtClock((Date.now() - +el.dataset.recT) / 1000); });
  if (ui.follow) { const c = carById(ui.follow); if (c) map.panTo(carPos(c).p, { animate: true }); }
  renderAges();
}, 350);

function renderAlerts(state) {
  const list = state.alerts.filter(a => !a.ack && a.kind !== 'sos').slice().reverse();
  $('#alertsSec').hidden = !list.length;
  $('#alertCount').textContent = list.length;
  $('#alerts').innerHTML = list.slice(0, 8).map(a => `<div class="alert ${a.kind}${a.info ? ' info' : ''}" ${a.orderId ? `data-goto="${a.orderId}"` : ''}>${icon('alert', { size: 18 })}<div><div>${esc(a.text)}</div><div class="tm">${fmtTime(a.t)}</div></div><button class="x" data-ack="${a.id}">OK</button></div>`).join('');
  $$('[data-ack]').forEach(b => b.onclick = e => { e.stopPropagation(); bus.act('ackAlert', { id: b.dataset.ack }); });
  $$('#alerts [data-goto]').forEach(el => el.onclick = () => { ui.tab = orderById(el.dataset.goto)?.status === 'programata' ? 'precomenzi' : 'comenzi'; selectOrder(el.dataset.goto, true); });
  for (const a of state.alerts) {
    if (a.ack || ui.seenAlerts.has(a.id)) continue;
    ui.seenAlerts.add(a.id);
    if (a.kind === 'sos') { beep([1200, .25, 800, .25, 1200, .25, 800, .25], .3); toast(esc(a.text), 'bad', 8000, 'shield'); const c = carById(a.carId); map.setView(c ? carPos(c).p : [a.lat, a.lon], 16); }
    else if (!a.info) beep([700, .12, 500, .16]);
  }
}

function renderStations(state) {
  const html = CONFIG.stations.map(s => {
    const q = stationQueue(state, s.id);
    return `<div class="citem" data-st="${s.id}" style="padding:7px 0;border:0">
      <span class="no" style="background:${q.length ? 'var(--free)' : 'var(--pause)'}">${q.length}</span>
      <span class="grow"><div class="nm">${esc(s.name)}</div><div class="sub">${q.length ? q.map(c => c.cs).join(' → ') : 'goală'}</div></span></div>`;
  }).join('');
  if ($('#stations').dataset.h === html) return;
  $('#stations').innerHTML = html; $('#stations').dataset.h = html;
  $$('#stations [data-st]').forEach(el => el.onclick = () => { const s = CONFIG.stations.find(x => x.id === el.dataset.st); map.setView([s.lat, s.lon], 16); });
}

function renderOrderPins(state) {
  orderLayer.clearLayers();
  for (const o of state.orders) {
    if (!['cautare', 'oferita'].includes(o.status)) continue;
    const m = L.marker([o.pickup.lat, o.pickup.lon], { icon: pinIcon('order', 'person'), zIndexOffset: 3000, title: `#${o.code}` }).addTo(orderLayer);
    m.on('click', () => selectOrder(o.id, true));
  }
}

function smsNotices(state) {
  for (const o of state.orders) {
    if (o.source !== 'telefon' || o.status !== 'acceptata' || ui.smsSent.has(o.id)) continue;
    ui.smsSent.add(o.id);
    const car = carById(o.carId);
    if (car) toast(`SMS trimis la ${esc(o.client.phone)}: „Taxi ${car.cs} (${esc(car.plate)}, ${esc(car.model)}) ajunge în ${fmtMin(etaSeconds(car))}.”`, 'ok', 6000, 'message');
  }
}
function driverMsgNotices(state) {
  const inc = state.driverMsgs.filter(m => m.to === 'dispecer');
  const unseen = inc.filter(m => m.t > ui.seenDriverMsgs);
  $('#cntM').hidden = !unseen.length || ui.tab === 'mesaje'; $('#cntM').textContent = unseen.length;
  if (ui.tab === 'mesaje' && inc.length) ui.seenDriverMsgs = inc[inc.length - 1].t;
  const last = unseen[unseen.length - 1];
  if (last && !ui.toastedMsg?.[last.id]) { (ui.toastedMsg ||= {})[last.id] = true; const c = carById(last.from); toast(`<b>${c ? c.cs + ' · ' + esc(firstName(c.driver)) : 'Șofer'}:</b> ${esc(last.text)}`, '', 5000, 'message'); beep([880, .1]); }
}

// ---------- apeluri de la clienți (centrala telefonică, simulată în demo) ----------
function simulateIncoming(force = false) {
  if (ui.incoming && !force) return;
  const known = Object.values(bus.state.clients);
  const k = Math.random() < 0.65 && known.length ? known[Math.floor(Math.random() * known.length)] : null;
  const phone = k ? k.phone : `07${Math.floor(20 + Math.random() * 70)} ${Math.floor(100 + Math.random() * 900)} ${Math.floor(100 + Math.random() * 900)}`;
  ui.incoming = { phone, t: Date.now() };
  beep([620, .3, 760, .4], .2);
  renderCallBox();
}
function renderCallBox() {
  const inc = ui.incoming;
  if (!inc) { $('#callBox').innerHTML = ''; return; }
  const c = bus.state.clients[phoneKey(inc.phone)];
  $('#callBox').innerHTML = `<div class="in-call">
    <div class="ring-ic">${icon('phone', { size: 22 })}</div>
    <div class="grow"><div class="small" style="font-weight:800;opacity:.75">APEL INTRARE</div><b>${esc(inc.phone)}</b>${c ? `<div class="small">${esc(c.name)} · ${c.rides} curse${c.last ? ` · ultima: ${esc(c.last.address)}` : ''}</div>` : '<div class="small">Număr nou</div>'}</div>
    <button class="btn sm go" id="incTake">Preia</button><button class="btn sm ghost" id="incDrop" aria-label="Respinge">${icon('close', { size: 16 })}</button>
  </div>`;
  $('#incTake').onclick = () => { $('#fPhone').value = inc.phone; $('#fPhone').dispatchEvent(new Event('input')); ui.incoming = null; renderCallBox(); ($('#useKnown') ? $('#fPickup') : $('#fName')).focus(); };
  $('#incDrop').onclick = () => { ui.incoming = null; renderCallBox(); };
}
(function loopCalls() { setTimeout(() => { if (bus.state && bus.state.bgOrders && document.visibilityState === 'visible') simulateIncoming(); loopCalls(); }, 80000 + Math.random() * 70000); })();

// ---------- liste ----------
const activeStatuses = ['cautare', 'oferita', 'acceptata', 'sosit', 'in_cursa'];
function matchesQ(o) {
  const q = ui.q.toLowerCase(); if (!q) return true;
  const car = o.carId ? carById(o.carId) : null;
  const hay = [o.code, o.client.name, phoneKey(o.client.phone), o.pickup.label, o.dest && o.dest.label, car && car.cs, car && car.plate, car && car.driver].join(' ').toLowerCase();
  return hay.includes(q.replace(/\s/g, '')) || hay.includes(q);
}
function renderLists() {
  const st = bus.state;
  const active = st.orders.filter(o => activeStatuses.includes(o.status));
  const sched = st.orders.filter(o => o.status === 'programata');
  $('#cntO').textContent = active.length;
  $('#cntP').textContent = sched.length;
  $('#cntC').textContent = st.cars.filter(c => c.status !== STATUS.offline).length;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === ui.tab));
  let html = '';
  if (ui.tab === 'comenzi') {
    const order = { cautare: 0, oferita: 0, acceptata: 1, sosit: 1, in_cursa: 2 };
    const list = (ui.q ? st.orders.filter(matchesQ) : active).slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (a.source === 'fundal') - (b.source === 'fundal') || b.createdAt - a.createdAt);
    html = list.length ? list.map(orderRow).join('') : `<p class="muted center" style="padding:30px">${ui.q ? 'Nimic găsit.' : 'Nicio comandă activă.'}</p>`;
  } else if (ui.tab === 'precomenzi') {
    const list = sched.filter(matchesQ).sort((a, b) => a.scheduledFor - b.scheduledFor);
    let lastDay = '';
    html = list.map(o => {
      const day = new Date(o.scheduledFor).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
      const head = day !== lastDay ? `<div class="cgroup">${day}</div>` : ''; lastDay = day;
      return head + orderRow(o);
    }).join('') || '<p class="muted center" style="padding:30px">Nicio cursă programată.</p>';
  } else if (ui.tab === 'masini') {
    const groups = ['liber_statie', 'liber_drum', 'spre_client', 'cu_client', 'pauza', 'offline'];
    for (const g of groups) {
      const cars = st.cars.filter(c => carCategory(c) === g && (!ui.q || [c.cs, c.plate, c.driver].join(' ').toLowerCase().includes(ui.q.toLowerCase())));
      if (!cars.length) continue;
      const cc = g.startsWith('liber') ? 'liber' : g;
      html += `<div class="cgroup"><span class="lg-car ${cc}">${carSvg(cc, 16)}</span>${CATEGORY_LABEL[g]} · ${cars.length}</div>`;
      html += cars.map(c => {
        const o = c.orderId ? orderById(c.orderId) : null;
        const left = pauseLeft(c);
        const sub = g === 'liber_statie' ? `Stația ${esc(CONFIG.stations.find(s => s.id === c.station)?.name || '')} · ${stationQueue(st, c.station).findIndex(x => x.id === c.id) + 1} la rând`
          : o ? `#${o.code} · ${esc(o.status === 'in_cursa' ? (o.dest || o.destInCar || {}).label || '' : o.pickup.label)} · ${fmtMin(etaSeconds(c))}`
            : g === 'liber_drum' && c.move ? 'Merge spre stație' : g === 'pauza' ? (left != null ? `Revine în ${fmtClock(left)}` : 'Pauză fără durată') : g === 'offline' ? 'Nu e în tură' : 'Liber';
        return `<div class="citem ${ui.selCar === c.id ? 'sel' : ''}" data-car="${c.id}">${carTag(c)}<span class="grow"><div class="nm">${esc(c.driver)}${c.human ? ' <span class="src app">APLICAȚIE</span>' : ''}${c.recording ? ' <span class="src sos">REC</span>' : ''}</div><div class="sub">${sub}</div></span><span class="caps">${carCapsList(c).map(x => icon(x.icon, { size: 15 })).join('')}</span></div>`;
      }).join('');
    }
  } else if (ui.tab === 'mesaje') {
    const msgs = st.driverMsgs.slice().reverse();
    html = `<div class="msg-compose">
        <div class="f2" style="grid-template-columns:auto 1fr;align-items:center"><span class="small" style="font-weight:800">Către</span>
          <select class="input" id="msgTo"><option value="toti">Toți șoferii (${st.cars.filter(c => c.status !== STATUS.offline).length})</option>${st.cars.filter(c => c.status !== STATUS.offline).map(c => `<option value="${c.id}" ${ui.msgTo === c.id ? 'selected' : ''}>${c.cs} · ${esc(c.driver)}</option>`).join('')}</select></div>
        <div class="chips wrap" style="margin:8px 0">${['Avem nevoie de mașini la Kaufland', 'Trafic blocat pe Calea Victoriei', 'Verificați aplicația, sunt comenzi în așteptare', 'Sunați la dispecerat'].map(t => `<button class="chip sm" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="hstack"><input class="input" id="msgText" placeholder="Scrie un mesaj…"><button class="btn primary" id="msgSend">${icon('nav', { size: 18 })}Trimite</button></div>
      </div>` + (msgs.length ? msgs.map(m => {
        const fromCar = m.from !== 'dispecer' ? carById(m.from) : null;
        const toCar = m.to !== 'toti' && m.to !== 'dispecer' ? carById(m.to) : null;
        return `<div class="dm ${fromCar ? 'in' : ''}"><div class="small muted">${fromCar ? `${fromCar.cs} · ${esc(fromCar.driver)} → dispecerat` : `Dispecerat → ${toCar ? toCar.cs + ' · ' + esc(toCar.driver) : 'toți șoferii'}`} · ${fmtTime(m.t)}</div>${esc(m.text)}</div>`;
      }).join('') : '<p class="muted center" style="padding:20px">Niciun mesaj încă.</p>');
  } else {
    const done = st.orders.filter(o => ['finalizata', 'anulata'].includes(o.status) && matchesQ(o)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, 80);
    html = done.length ? done.map(orderRow).join('') : '<p class="muted center" style="padding:30px">Încă nu sunt curse încheiate.</p>';
  }
  if (html !== ui.lastLists) {
    const sc = $('#list').scrollTop;
    const keepText = $('#msgText') ? $('#msgText').value : '';
    $('#list').innerHTML = html; ui.lastLists = html; $('#list').scrollTop = sc;
    $$('#list [data-order]').forEach(el => el.onclick = () => selectOrder(el.dataset.order));
    $$('#list [data-car]').forEach(el => el.onclick = () => selectCar(el.dataset.car));
    if ($('#msgText')) {
      $('#msgText').value = keepText;
      $('#msgTo').onchange = e => { ui.msgTo = e.target.value; };
      $$('[data-tpl]').forEach(b => b.onclick = () => { $('#msgText').value = b.dataset.tpl; $('#msgText').focus(); });
      const send = () => { const t = $('#msgText').value.trim(); if (!t) return; bus.act('driverMsg', { carId: ui.msgTo === 'toti' ? null : ui.msgTo, text: t }); $('#msgText').value = ''; toast(ui.msgTo === 'toti' ? 'Mesaj trimis tuturor șoferilor' : 'Mesaj trimis', 'ok', 2000, 'check'); };
      $('#msgSend').onclick = send; $('#msgText').onkeydown = e => { if (e.key === 'Enter') send(); };
    }
  }
}

function orderRow(o) {
  const car = o.carId ? carById(o.carId) : o.reservedBy ? carById(o.reservedBy) : null;
  const srcLbl = { app: 'APP', telefon: 'TEL', fundal: 'APP' }[o.source];
  const when = o.status === 'programata' ? `la ${fmtTime(o.scheduledFor)}` : fmtTime(o.createdAt);
  const extra = o.status === 'acceptata' && car ? ` · sosește în ${fmtMin(etaSeconds(car))}` : o.status === 'finalizata' ? ` · ${fmtMoney(o.fare)} lei ${o.payment === 'card' ? '(card)' : '(cash)'}${o.tip ? ` + ${fmtMoney(o.tip.amount)} bacșiș` : ''}` : '';
  const req = reqOptions(o.options);
  const pend = o.request && o.request.status === 'pending' ? carById(o.request.carId) : null;
  const schedTag = o.status === 'programata' ? (o.reservedBy ? `<span class="os sosit">Rezervată</span>` : pend ? `<span class="os oferita">Cerere la ${pend.cs}</span>` : `<span class="os programata">Fără șofer</span>`) : `<span class="os ${o.status}">${ORDER_LABEL[o.status]}</span>`;
  return `<div class="oitem ${ui.selOrder === o.id ? 'sel' : ''} ${o.priority ? 'prio' : ''} ${o.sos && o.sos.active ? 'sosrow' : ''}" data-order="${o.id}">
    <span class="code">#${o.code}</span>
    <span class="addr">${o.priority ? '⚑ ' : ''}${esc(o.pickup.label)}${o.dest ? ` → ${esc(o.dest.label)}` : ''}</span>
    ${schedTag}
    <div class="meta"><span class="src ${o.source === 'fundal' ? 'app' : o.source}">${srcLbl}</span><span>${esc(o.client.name)}</span><span>${when}</span>${['cautare', 'oferita'].includes(o.status) ? `<span class="age" data-age="${o.createdAt}"></span>` : ''}${car ? `<span><b>${car.cs}</b> ${esc(car.driver.split(' ')[0])}</span>` : ''}${req.length ? `<span class="optl">${req.map(optionLabel).join(', ')}</span>` : ''}<span>${extra}</span></div>
  </div>`;
}
function renderAges() {
  $$('[data-age]').forEach(el => {
    const s = (Date.now() - +el.dataset.age) / 1000 * (bus.state ? bus.state.speedMul : 1);
    el.textContent = 'așteaptă ' + fmtClock(s);
    el.className = 'age ' + (s > 120 ? 'bad' : s > 60 ? 'warn' : '');
  });
}

// ---------- detalii ----------
function selectOrder(id, force) { ui.selOrder = ui.selOrder === id && !force ? null : id; ui.selCar = null; ui.lastLists = ''; renderLists(); renderDetail(true); fleet.update(bus.state); }
function selectCar(id) { ui.selCar = ui.selCar === id ? null : id; ui.selOrder = null; ui.lastLists = ''; if (ui.tab !== 'masini') ui.tab = 'masini'; renderLists(); renderDetail(true); fleet.update(bus.state); }

const TL = { creata: 'Comandă creată', oferita: 'Trimisă la', refuzata: 'Refuzată de', fara_raspuns: 'Fără răspuns de la', acceptata: 'Acceptată de', sosit: 'Șoferul a ajuns', in_cursa: 'Clientul a urcat', finalizata: 'Cursă terminată', card_incasat: 'Plată card încasată automat', cash_incasat: 'Cash încasat', anulata: 'Anulată', realocata: 'Realocată', rezervata: 'Rezervată din timp de', cerere: 'Cerere trimisă către', cerere_refuzata: 'Cerere refuzată de', rezervare_anulata: 'Rezervare anulată', activata: 'A pornit (ora programată)', bacsis: 'Bacșiș primit' };
let detailKey = '';
function renderDetail(focus) {
  const box = $('#detail');
  const o = ui.selOrder ? orderById(ui.selOrder) : null;
  const car = ui.selCar ? carById(ui.selCar) : (o && o.carId ? carById(o.carId) : null);
  if (!o && !ui.selCar) { box.innerHTML = ''; detailKey = ''; route.clear(); return; }
  if (o) {
    const key = o.id + o.status + (o.carId || '') + (o.offer ? o.offer.carId : '') + (o.reservedBy || '') + (o.priority ? 1 : 0) + (o.request ? o.request.status : '') + Math.floor(Date.now() / 5000);
    if (key !== detailKey) {
      detailKey = key;
      const canAssign = ['cautare', 'oferita', 'programata'].includes(o.status);
      const req = reqOptions(o.options);
      const pool = o.status === 'programata' ? bus.state.cars.filter(c => c.status !== STATUS.offline) : bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId);
      const cands = canAssign ? pool.map(c => ({ c, d: dist(carPos(c).p, [o.pickup.lat, o.pickup.lon]), fit: req.every(k => carHas(c, k)) })).sort((a, b) => (b.fit - a.fit) || a.d - b.d).slice(0, 5) : [];
      const ci = clientInfo(bus.state, o.client);
      const rc = o.reservedBy ? carById(o.reservedBy) : null;
      box.innerHTML = `<div class="detail">
        <div class="hd"><b style="font-size:1.1em">#${o.code}</b><span class="os ${o.status}">${ORDER_LABEL[o.status]}</span>${o.priority ? '<span class="os anulata" style="text-decoration:none;background:var(--danger-soft);color:var(--danger)">Urgent</span>' : ''}<button class="icon-btn flat" style="width:34px;height:34px;margin-left:auto" id="dClose">${icon('close', { size: 18 })}</button></div>
        <div><b>${esc(ci.name)}</b> · ${esc(o.client.phone)} <span class="small muted">${ci.rating ? `★ ${ci.rating.toLocaleString('ro-RO')} · ` : ''}${ci.rides} curse</span></div>
        ${o.scheduledFor ? `<div class="small" style="margin-top:4px">${icon('calendar', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${new Date(o.scheduledFor).toLocaleString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${rc ? ` · rezervată de <b>${rc.cs} ${esc(rc.driver)}</b>` : ''}</div>` : ''}
        <div class="small" style="margin-top:4px">${icon('person', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc(o.pickup.label)}</div>
        ${o.dest || o.destInCar ? `<div class="small">${icon('flag', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc((o.dest || o.destInCar).label)}${o.estimate ? ` · ${o.estimate.low}–${o.estimate.high} lei` : ''}</div>` : ''}
        <div class="small muted" style="margin-top:4px">${o.payment === 'card' ? `Card ${esc(o.card ? '•••• ' + o.card.last4 : '')}` : 'Cash'}${o.note ? ` · „${esc(o.note)}”` : ''}</div>
        ${req.length ? `<div class="small" style="margin-top:4px">Cerințe: ${req.map(k => `<b>${optionLabel(k)}</b>`).join(', ')}${car ? ` · mașina are: ${req.map(k => carHas(car, k) ? '✓' : '✕').join(' ')}` : ''}</div>` : ''}
        ${o.offer ? `<div class="small" style="margin-top:6px;color:var(--danger);font-weight:700">Așteaptă răspuns de la ${esc(carById(o.offer.carId)?.driver || '')} (${carById(o.offer.carId)?.cs})…</div>` : ''}
        ${o.review ? `<div class="small" style="margin-top:6px">Recenzie client: <span class="stars-s">${'★'.repeat(o.review.stars)}</span> ${esc(o.review.text || o.review.tags.join(', '))}</div>` : ''}
        ${o.driverReview ? `<div class="small">Recenzie șofer: <span class="stars-s">${'★'.repeat(o.driverReview.stars)}</span> ${esc(o.driverReview.text || o.driverReview.tags.join(', '))}</div>` : ''}
        <div class="dbtns">
          <button class="btn sm" id="dCallCl">${icon('phone', { size: 16 })}Client</button>
          ${car ? `<button class="btn sm" id="dCallDr">${icon('phone', { size: 16 })}Șofer</button><button class="btn sm" id="dMsgDr">${icon('message', { size: 16 })}Mesaj șofer</button>` : ''}
          ${activeStatuses.includes(o.status) || o.status === 'programata' ? `<button class="btn sm" id="dPrio">${o.priority ? 'Normal' : '⚑ Urgent'}</button>` : ''}
        </div>
        ${canAssign ? `<div class="small" style="margin-top:10px;font-weight:800">${o.status === 'programata' ? 'Rezervă un șofer din timp:' : 'Alocă manual (potrivite și apropiate):'}</div>${cands.map(x => `<button class="cand" data-assign="${x.c.id}">${carTag(x.c)}<span class="grow"><b>${esc(x.c.driver)}</b>${x.c.human ? ' <span class="src app">APP</span>' : ''}<div class="small muted">${fmtKm(x.d)}${x.c.station ? ' · în stație' : ''}${req.length ? (x.fit ? ' · are dotările' : ' · fără dotări') : ''}${x.c.status === STATUS.pauza ? ' · în pauză' : x.c.status !== STATUS.liber ? ' · ocupat acum' : ''}</div></span>${icon('chevron', { size: 18 })}</button>`).join('') || '<div class="small muted">Nicio mașină liberă acum.</div>'}` : ''}
        <ul class="timeline">${o.timeline.map(t => `<li><b>${fmtTime(t.t)}</b><span>${TL[t.s] || t.s}${t.car ? ' ' + esc((carById(t.car) || {}).driver || '') + ' (' + ((carById(t.car) || {}).cs || '') + ')' : ''}${t.fare ? ` · ${fmtMoney(t.fare)} lei` : ''}</span></li>`).join('')}</ul>
        ${activeStatuses.includes(o.status) || o.status === 'programata' ? `<button class="btn sm danger-soft block" style="margin-top:10px" id="dCancel">Anulează comanda</button>` : ''}
      </div>`;
      $('#dClose').onclick = () => selectOrder(o.id);
      $('#dCallCl').onclick = () => calls.call({ role: 'client', id: phoneKey(o.client.phone), name: o.client.name }, o.id);
      const cd = $('#dCallDr'); if (cd) cd.onclick = () => calls.call({ role: 'sofer', id: car.id, name: car.driver }, o.id);
      const md = $('#dMsgDr'); if (md) md.onclick = () => { ui.msgTo = car.id; ui.tab = 'mesaje'; ui.lastLists = ''; renderLists(); setTimeout(() => $('#msgText') && $('#msgText').focus(), 50); };
      const pr = $('#dPrio'); if (pr) pr.onclick = () => bus.act('setPriority', { orderId: o.id, value: !o.priority });
      $$('[data-assign]', box).forEach(b => b.onclick = () => { bus.act('assign', { orderId: o.id, carId: b.dataset.assign }); const c = carById(b.dataset.assign); toast(o.status === 'programata' ? `Cursa #${o.code} rezervată pentru ${esc(c.driver)} (${c.cs})` : `Comanda #${o.code} trimisă la ${esc(c.driver)} (${c.cs})`, 'ok', 2500); });
      const dc = $('#dCancel', box); if (dc) dc.onclick = () => cancelWithReason(o);
    }
    if (focus) {
      const pts = [[o.pickup.lat, o.pickup.lon]];
      if (car) pts.push(carPos(car).p);
      if (o.dest) pts.push([o.dest.lat, o.dest.lon]);
      map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 16 });
    }
  } else {
    const c = carById(ui.selCar);
    const key = c.id + c.status + (c.orderId || '') + (c.station || '') + (c.recording ? 1 : 0) + Math.floor(Date.now() / 5000);
    if (key !== detailKey) {
      detailKey = key;
      const cat = carCategory(c);
      const o2 = c.orderId ? orderById(c.orderId) : null;
      const res = bus.state.orders.filter(x => x.status === 'programata' && x.reservedBy === c.id);
      const left = pauseLeft(c);
      box.innerHTML = `<div class="detail">
        <div class="hd">${carTag(c)}<b>${esc(c.driver)}</b><span class="pill st-${cat}">${CATEGORY_LABEL[cat]}${left != null ? ' · ' + fmtClock(left) : ''}</span><button class="icon-btn flat" style="width:34px;height:34px;margin-left:auto" id="dClose">${icon('close', { size: 18 })}</button></div>
        <div class="small">${esc(c.plate)} · ${esc(c.model)} ${esc(c.color)} · ★ ${c.rating.toLocaleString('ro-RO')} · ${c.years} ani experiență</div>
        <div class="capicons" style="margin-top:6px">${carCapsList(c).map(x => `<span class="pill">${icon(x.icon, { size: 14 })}${x.short}</span>`).join('') || '<span class="small muted">Fără dotări speciale</span>'}</div>
        <div class="grid3" style="margin-top:10px">
          <div class="stat" style="background:var(--surface)"><div class="k">Curse azi</div><div class="v">${c.earnings.rides}</div></div>
          <div class="stat" style="background:var(--surface)"><div class="k">Încasat</div><div class="v">${Math.round(c.earnings.cash + c.earnings.card)}</div></div>
          <div class="stat" style="background:var(--surface)"><div class="k">Bacșiș</div><div class="v">${Math.round(c.earnings.tips || 0)}</div></div>
        </div>
        ${o2 ? `<button class="cand" data-gotoorder="${o2.id}" style="margin-top:10px"><span class="os ${o2.status}">${ORDER_LABEL[o2.status]}</span><span class="grow"><b>#${o2.code}</b> ${esc(o2.pickup.label)}</span>${icon('chevron', { size: 18 })}</button>` : ''}
        ${res.map(r => `<button class="cand" data-gotoorder="${r.id}" style="margin-top:6px"><span class="os sosit">${fmtTime(r.scheduledFor)}</span><span class="grow">Rezervată: ${esc(r.pickup.label)}</span>${icon('chevron', { size: 18 })}</button>`).join('')}
        <div class="dbtns"><button class="btn sm" id="dCall">${icon('phone', { size: 16 })}Sună</button><button class="btn sm" id="dMsg">${icon('message', { size: 16 })}Mesaj</button><button class="btn sm" id="dFocus">${icon('locate', { size: 16 })}Pe hartă</button></div>
        ${c.reviews && c.reviews.length ? `<div class="small muted" style="margin-top:10px;font-weight:700">Ultimele recenzii</div>${c.reviews.slice(0, 3).map(r => `<div class="small" style="margin-top:3px"><span class="stars-s">${'★'.repeat(r.stars)}</span> ${esc(r.text)}</div>`).join('')}` : ''}
      </div>`;
      $('#dClose').onclick = () => selectCar(c.id);
      $('#dCall').onclick = () => calls.call({ role: 'sofer', id: c.id, name: c.driver });
      $('#dMsg').onclick = () => { ui.msgTo = c.id; ui.tab = 'mesaje'; ui.lastLists = ''; renderLists(); setTimeout(() => $('#msgText') && $('#msgText').focus(), 50); };
      $('#dFocus').onclick = () => map.setView(carPos(c).p, 16);
      $$('[data-gotoorder]', box).forEach(b => b.onclick = () => { const oo = orderById(b.dataset.gotoorder); ui.tab = oo && oo.status === 'programata' ? 'precomenzi' : 'comenzi'; selectOrder(b.dataset.gotoorder, true); });
    }
    if (focus) map.setView(carPos(c).p, Math.max(map.getZoom(), 15));
  }
}

function cancelWithReason(o) {
  const reasons = ['Clientul a renunțat', 'Nicio mașină disponibilă', 'Adresă greșită', 'Comandă dublă', 'Altul'];
  const ov = modal(`
    <div class="panel-head"><h2>Anulezi comanda #${o.code}?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin-top:-6px">Clientul și șoferul vor fi anunțați. Alege motivul:</p>
    <div class="vstack">${reasons.map(r => `<button class="btn block" data-r="${r}" style="justify-content:flex-start">${r}</button>`).join('')}</div>`);
  $$('[data-r]', ov).forEach(b => b.onclick = () => { bus.act('cancelOrder', { orderId: o.id, by: 'dispecer', reason: b.dataset.r }); ov.close(); toast(`Comanda #${o.code} a fost anulată`, '', 2500); });
}

let lastRoute = 0, lastList = 0;
function frame(now) {
  if (now - lastRoute > 1000) {
    lastRoute = now;
    const o = ui.selOrder ? orderById(ui.selOrder) : null;
    const car = ui.selCar ? carById(ui.selCar) : (o && o.carId ? carById(o.carId) : null);
    if (car && car.move) route.set(remainingRoute(car), car.status === STATUS.cu ? cssVar('--busy') : car.status === STATUS.spre ? cssVar('--to') : cssVar('--free'));
    else route.clear();
  }
  if (now - lastList > 3000) { lastList = now; renderLists(); }
}

// ---------- formular telefonic ----------
const fPhone = $('#fPhone'), fName = $('#fName'), fPickup = $('#fPickup'), fDest = $('#fDest');
fPhone.oninput = () => {
  const c = bus.state.clients[phoneKey(fPhone.value)];
  const last = c && c.history && c.history[0];
  $('#known').innerHTML = c ? `<div class="known">${icon('user', { size: 18 })}<div class="grow"><b>${esc(c.name)}</b> · ${c.rides} curse${c.reviews && c.reviews.length ? ` · ★ ${clientInfo(bus.state, c).rating.toLocaleString('ro-RO')}` : ''}<div class="small">Ultima adresă: ${esc(c.last ? c.last.address : '—')}</div>
      ${last && last.dest ? `<button type="button" class="btn sm dark" id="repeatLast" style="margin-top:6px">${icon('refresh', { size: 14 })}Din nou: ${esc(last.pickup.label)} → ${esc(last.dest.label)}</button>` : ''}</div>
      <button type="button" class="btn sm dark" id="useKnown">Folosește</button></div>` : '';
  const uk = $('#useKnown'); if (uk) uk.onclick = () => { fName.value = c.name; if (c.last) setFormPlace('pickup', { lat: c.last.lat, lon: c.last.lon, label: c.last.address }); fDest.focus(); };
  const rl = $('#repeatLast'); if (rl) rl.onclick = () => { fName.value = c.name; setFormPlace('pickup', last.pickup); setFormPlace('dest', last.dest); };
  if (c && !fName.value) fName.value = c.name;
};
function setupAutocomplete(input, box, kind) {
  let results = [], hl = 0;
  const draw = () => {
    box.hidden = !results.length;
    box.innerHTML = results.map((r, i) => `<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}"><div><b>${esc(r.label)}</b></div><div class="s">${esc(r.sub || '')}</div></button>`).join('');
    $$('button', box).forEach(b => b.onmousedown = e => { e.preventDefault(); choose(+b.dataset.i); });
  };
  const choose = i => { const r = results[i]; if (!r) return; setFormPlace(kind, { lat: r.lat, lon: r.lon, label: r.label }); results = []; draw(); };
  input.oninput = () => { ui.form[kind] = null; updateFormMarkers(); results = input.value.trim().length >= 2 ? cityMap.search(input.value, 8) : []; hl = 0; draw(); };
  input.onkeydown = e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { hl = Math.min(results.length - 1, hl + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter') { choose(hl); e.preventDefault(); }
  };
  input.onblur = () => setTimeout(() => { box.hidden = true; }, 150);
}
setupAutocomplete(fPickup, $('#acPickup'), 'pickup');
setupAutocomplete(fDest, $('#acDest'), 'dest');

function setFormPlace(kind, place) {
  ui.form[kind] = place;
  (kind === 'pickup' ? fPickup : fDest).value = place.label;
  updateFormMarkers();
  const pts = [ui.form.pickup, ui.form.dest].filter(Boolean).map(p => [p.lat, p.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 16 });
}
function updateFormMarkers() {
  if (formPickupMk) { map.removeLayer(formPickupMk); formPickupMk = null; }
  if (formDestMk) { map.removeLayer(formDestMk); formDestMk = null; }
  const p = ui.form.pickup, d = ui.form.dest;
  if (p) formPickupMk = L.marker([p.lat, p.lon], { icon: pinIcon('pickup', 'person'), zIndexOffset: 4000 }).addTo(map);
  if (d) formDestMk = L.marker([d.lat, d.lon], { icon: pinIcon('dest', 'flag'), zIndexOffset: 4000 }).addTo(map);
  if (p && d) {
    const r = cityMap.route([p.lat, p.lon], [d.lat, d.lon]);
    const est = estimateFare(r.meters, new Date(), r.slow);
    $('#fEst').innerHTML = `Estimat: <b>${est.low}–${est.high} lei</b> · ${est.km.toLocaleString('ro-RO')} km · ~${est.minutes} min cu traficul`;
  } else $('#fEst').textContent = '';
}

function startPick(kind) {
  ui.picking = kind;
  $('#dmap').classList.add('picking');
  $('#mapHint').hidden = false;
  $('#mapHint').textContent = kind === 'pickup' ? 'Click pe hartă unde așteaptă clientul (Esc = renunță)' : 'Click pe hartă pe destinație (Esc = renunță)';
}
function stopPick() { ui.picking = null; $('#dmap').classList.remove('picking'); $('#mapHint').hidden = true; }
$('#pickMapBtn').onclick = () => startPick('pickup');
$('#destMapBtn').onclick = () => startPick('dest');
map.on('click', e => {
  if (!ui.picking) return;
  const p = [e.latlng.lat, e.latlng.lng];
  setFormPlace(ui.picking, { lat: p[0], lon: p[1], label: cityMap.reverse(p) });
  stopPick();
});
map.on('dragstart', () => { ui.follow = null; });

function buildOrder(forceCar) {
  const phone = fPhone.value.trim(), name = fName.value.trim() || 'Client';
  if (!ui.form.pickup) { toast('Alege adresa de preluare din listă sau de pe hartă.', 'warn'); fPickup.focus(); return null; }
  if (phone.replace(/\D/g, '').length < 9) { toast('Introdu numărul de telefon al clientului.', 'warn'); fPhone.focus(); return null; }
  const options = {}; $$('[data-o]').forEach(c => { if (c.checked) options[c.dataset.o] = true; });
  let scheduledFor = null;
  if ($('#fWhen').value) {
    const [hh, mm] = $('#fWhen').value.split(':').map(Number);
    const d = $('#fDay').value ? new Date($('#fDay').value + 'T00:00') : new Date();
    d.setHours(hh, mm, 0, 0);
    if (!$('#fDay').value && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    if (d.getTime() < Date.now() + 5 * 60e3) { toast('Ora programării e în trecut.', 'warn'); return null; }
    scheduledFor = d.getTime();
  }
  const p = ui.form.pickup, d = ui.form.dest;
  return {
    id: uid('o'), source: 'telefon', client: { name, phone }, pickup: p, dest: d, options, note: $('#fNote').value.trim(), payment: 'cash',
    priority: $('#fUrgent').checked, scheduledFor, forceCar,
  };
}
function resetForm() {
  $('#phoneForm').reset(); $('#known').innerHTML = ''; ui.form = { pickup: null, dest: null }; updateFormMarkers();
}
$('#phoneForm').onsubmit = e => {
  e.preventDefault();
  const o = buildOrder(null); if (!o) return;
  bus.act('createOrder', o);
  toast(o.scheduledFor ? `Precomandă salvată pentru ${new Date(o.scheduledFor).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Comanda a fost trimisă la cel mai potrivit șofer', 'ok', 3000);
  resetForm(); ui.tab = o.scheduledFor ? 'precomenzi' : 'comenzi'; ui.selOrder = o.id; ui.lastLists = '';
};
$('#pickCarBtn').onclick = () => {
  const o = buildOrder(null); if (!o) return;
  const req = reqOptions(o.options);
  const cands = bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId).map(c => ({ c, d: dist(carPos(c).p, [o.pickup.lat, o.pickup.lon]), fit: req.every(k => carHas(c, k)) })).sort((a, b) => (b.fit - a.fit) || a.d - b.d).slice(0, 8);
  const ov = modal(`
    <div class="panel-head"><h2>Alege mașina</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin-top:-6px">Mașini libere${req.length ? ', întâi cele cu dotările cerute' : ''}, de la cea mai apropiată de ${esc(o.pickup.label)}.</p>
    ${cands.map(x => `<button class="cand" data-c="${x.c.id}" style="background:var(--surface-2)">${carTag(x.c)}<span class="grow"><b>${esc(x.c.driver)}</b><div class="small muted">${fmtKm(x.d)} · ${x.c.station ? 'Stația ' + esc(CONFIG.stations.find(s => s.id === x.c.station)?.name || '') : 'pe drum'}${req.length ? (x.fit ? ' · are dotările' : ' · fără dotări') : ''}</div></span>${icon('chevron')}</button>`).join('') || '<p class="muted">Nicio mașină liberă acum. Trimite automat și comanda intră la rând.</p>'}
  `);
  $$('[data-c]', ov).forEach(b => b.onclick = () => {
    o.forceCar = b.dataset.c; bus.act('createOrder', o); ov.close();
    toast(`Comanda trimisă la ${esc(carById(b.dataset.c).driver)}`, 'ok'); resetForm(); ui.tab = 'comenzi'; ui.selOrder = o.id; ui.lastLists = '';
  });
};

// ---------- pornire ----------
{ const d = new Date(); $('#fDay').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
bus.on(onState);
boot.done();
