// Panoul DISPECERAT – vede toată flota, preia comenzi telefonice, alocă manual.
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, carCategory, CATEGORY_LABEL, ORDER_LABEL, stationQueue, etaSeconds, remainingRoute, estimateFare, uid, STATUS } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, cssVar } from './mapview.js';
import { icon } from './icons.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtMoney, beep, store, loadingScreen, unlockAudio } from './ui.js';

const L = window.L;
const boot = loadingScreen('Pornim dispeceratul…');
unlockAudio();
document.title = 'Dispecerat · ' + CONFIG.company.name;

let cityMap, bus, map, fleet, route;
const ui = { tab: 'comenzi', selOrder: null, selCar: null, filters: new Set(['liber_statie', 'liber_drum', 'spre_client', 'cu_client', 'pauza']), picking: null, form: { pickup: null, dest: null }, seenAlerts: new Set(), smsSent: new Set(), lastLists: '' };

try { cityMap = await CityMap.load(); } catch (e) { boot.fail('Nu am putut încărca harta.'); throw e; }

const CAT_COLOR = { liber_statie: 'var(--free)', liber_drum: 'var(--free)', spre_client: 'var(--to)', cu_client: 'var(--busy)', pauza: 'var(--pause)', offline: 'var(--pause)' };

document.body.innerHTML = `
<div class="dwrap">
  <header class="dhead">
    <div class="dbrand"><span class="logo">${icon('headset', { size: 20 })}</span>${esc(CONFIG.company.name)} · Dispecerat</div>
    <div class="kpis" id="kpis"></div>
    <div class="demo-ctl">
      <span class="lbl">Demo</span>
      <div class="segs" id="speed">${[1, 2, 5, 10].map(m => `<button data-m="${m}">x${m}</button>`).join('')}</div>
      <button class="btn sm" id="bgBtn" title="Comenzi automate în oraș">${icon('refresh', { size: 18 })}<span>Trafic</span></button>
      <button class="btn sm ghost" id="resetBtn" title="Repornește demo-ul">Reset</button>
      <span class="clock" id="clock"></span>
    </div>
  </header>
  <div class="dbody">
    <aside class="dcol left">
      <div class="dsec" id="alertsSec" hidden><h3>${icon('alert', { size: 16 })}Alerte <span class="count" id="alertCount">0</span><button class="btn sm ghost" id="ackAll" style="margin-left:auto;min-height:30px;padding:0 10px">Șterge tot</button></h3><div id="alerts"></div></div>
      <div class="dsec">
        <h3>${icon('phone', { size: 16 })}Comandă telefonică</h3>
        <form id="phoneForm" autocomplete="off">
          <div class="f2">
            <label class="dfield"><span>Telefon client</span><input class="input" id="fPhone" inputmode="tel" placeholder="07xx xxx xxx"></label>
            <label class="dfield"><span>Nume</span><input class="input" id="fName" placeholder="Nume client"></label>
          </div>
          <div id="known"></div>
          <label class="dfield"><span>Adresa de preluare <button type="button" class="pill" id="pickMapBtn" style="border:0;cursor:pointer;float:right">${icon('pin', { size: 14 })}pe hartă</button></span><input class="input" id="fPickup" placeholder="Stradă, număr sau loc cunoscut"><div class="ac" id="acPickup" hidden></div></label>
          <label class="dfield"><span>Destinație (opțional) <button type="button" class="pill" id="destMapBtn" style="border:0;cursor:pointer;float:right">${icon('pin', { size: 14 })}pe hartă</button></span><input class="input" id="fDest" placeholder="Unde merge clientul"><div class="ac" id="acDest" hidden></div></label>
          <div class="mini-opts">
            <label><input type="checkbox" data-o="bigTrunk">Portbagaj mare</label>
            <label><input type="checkbox" data-o="pet">Animal</label>
            <label><input type="checkbox" data-o="childSeat">Scaun copil</label>
            <label><input type="checkbox" data-o="help">Ajutor la urcare</label>
          </div>
          <div class="f2">
            <label class="dfield"><span>Mesaj pentru șofer</span><input class="input" id="fNote" placeholder="ex. scara 2"></label>
            <label class="dfield"><span>Programare</span><input class="input" id="fWhen" type="time" title="Lasă gol pentru acum"></label>
          </div>
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
      <div class="tabs" id="tabs">
        <button data-t="comenzi">Comenzi <span class="count" id="cntO">0</span></button>
        <button data-t="masini">Mașini <span class="count" id="cntC">0</span></button>
        <button data-t="istoric">Istoric</button>
      </div>
      <div id="detail"></div>
      <div class="tabbody" id="list"></div>
    </aside>
  </div>
</div>
<div class="demo-badge" style="top:auto;bottom:10px">DEMO</div>`;

map = createMap($('#map'), { cityMap, zoom: 14 });
route = new RouteLine(map);
bus = await connect(cityMap, { role: 'dispecer' });
window.taxiDemo = bus;
fleet = new FleetLayer(map, {
  filter: c => c.status !== STATUS.offline && ui.filters.has(carCategory(c)),
  selected: () => ui.selCar || (ui.selOrder && orderById(ui.selOrder)?.carId),
  tag: c => c.plate.split(' ')[1],
  onCar: id => selectCar(id),
  onStation: s => { map.setView([s.lat, s.lon], 16); },
  onFrame: frame,
});
const orderLayer = L.layerGroup().addTo(map);
const sosLayer = L.layerGroup().addTo(map);
let formPickupMk, formDestMk;

// ---------- antet ----------
$$('#speed button').forEach(b => b.onclick = () => bus.act('setSpeed', { mul: +b.dataset.m }));
$('#bgBtn').onclick = () => bus.act('setFlag', { key: 'bgOrders', value: !bus.state.bgOrders });
$('#resetBtn').onclick = async () => { if (await confirmBox('Repornești demo-ul?', 'Toate comenzile și cursele de azi se șterg. Șoferul din aplicație trebuie să intre din nou în tură.', { yes: 'Repornește', danger: true })) { bus.act('reset'); toast('Demo repornit', 'ok'); } };
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);
$$('#tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.t; ui.lastLists = ''; renderLists(); });
$('#ackAll').onclick = () => bus.act('ackAll');

// ---------- filtre hartă ----------
function renderFilters(counts) {
  const items = [['liber_statie', 'Liber în stație', true], ['liber_drum', 'Liber pe drum'], ['spre_client', 'Merge la client'], ['cu_client', 'Cu client'], ['pauza', 'Pauză']];
  $('#filters').innerHTML = items.map(([k, l, sq]) => `<button class="pill ${ui.filters.has(k) ? '' : 'off'}" data-f="${k}"><span class="sw" style="background:${CAT_COLOR[k]};${sq ? 'border-radius:3px' : ''}"></span>${l} <b>${counts[k] || 0}</b></button>`).join('');
  $$('#filters [data-f]').forEach(b => b.onclick = () => { const k = b.dataset.f; ui.filters.has(k) ? ui.filters.delete(k) : ui.filters.add(k); fleet.update(bus.state); renderFilters(counts); });
}

// ---------- stare ----------
const orderById = id => bus.state.orders.find(o => o.id === id);
const carById = id => bus.state.cars.find(c => c.id === id);

function onState(state) {
  if (!state) return;
  fleet.update(state);
  $$('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.m === state.speedMul));
  $('#bgBtn').classList.toggle('dark', state.bgOrders);
  const counts = {};
  for (const c of state.cars) { const k = carCategory(c); counts[k] = (counts[k] || 0) + 1; }
  renderFilters(counts);
  renderKpis(state, counts);
  renderAlerts(state);
  renderStations(state);
  renderOrderPins(state);
  renderLists();
  renderDetail();
  smsNotices(state);
}

function renderKpis(state, counts) {
  const online = state.cars.filter(c => c.status !== STATUS.offline).length;
  const free = (counts.liber_statie || 0) + (counts.liber_drum || 0);
  const rides = state.cars.reduce((a, c) => a + c.earnings.rides, 0);
  const revenue = state.cars.reduce((a, c) => a + c.earnings.cash + c.earnings.card, 0);
  const waits = state.orders.filter(o => o.arrivedAt && o.source !== 'fundal').map(o => (o.arrivedAt - o.createdAt) / 60000 * state.speedMul);
  const waiting = state.orders.filter(o => ['cautare', 'oferita'].includes(o.status)).length;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="k">În tură</div><div class="v">${online}<span class="small muted">/${state.cars.length}</span></div></div>
    <div class="kpi"><div class="k">Libere</div><div class="v"><span class="sw" style="background:var(--free)"></span>${free}</div></div>
    <div class="kpi"><div class="k">Spre client</div><div class="v"><span class="sw" style="background:var(--to)"></span>${counts.spre_client || 0}</div></div>
    <div class="kpi"><div class="k">Cu client</div><div class="v"><span class="sw" style="background:var(--busy)"></span>${counts.cu_client || 0}</div></div>
    <div class="kpi"><div class="k">Așteaptă șofer</div><div class="v" style="color:${waiting ? 'var(--danger)' : 'inherit'}">${waiting}</div></div>
    <div class="kpi"><div class="k">Curse azi</div><div class="v">${rides}</div></div>
    <div class="kpi"><div class="k">Încasări azi</div><div class="v">${Math.round(revenue).toLocaleString('ro-RO')} lei</div></div>
    ${waits.length ? `<div class="kpi"><div class="k">Timp mediu sosire</div><div class="v">${Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)} min</div></div>` : ''}`;
}

function renderAlerts(state) {
  const list = state.alerts.filter(a => !a.ack).slice().reverse();
  $('#alertsSec').hidden = !list.length;
  $('#alertCount').textContent = list.length;
  $('#alerts').innerHTML = list.slice(0, 8).map(a => `<div class="alert ${a.kind}${a.info ? ' info' : ''}">${icon(a.kind === 'sos' ? 'shield' : 'alert', { size: 18 })}<div><div>${esc(a.text)}</div><div class="tm">${fmtTime(a.t)}</div></div><button class="x" data-ack="${a.id}">OK</button></div>`).join('');
  $$('[data-ack]').forEach(b => b.onclick = () => bus.act('ackAlert', { id: b.dataset.ack }));
  for (const a of list) {
    if (ui.seenAlerts.has(a.id)) continue;
    ui.seenAlerts.add(a.id);
    if (a.kind === 'sos') { beep([1200, .25, 800, .25, 1200, .25, 800, .25], .3); toast(esc(a.text), 'bad', 8000, 'shield'); if (a.lat) map.setView([a.lat, a.lon], 16); }
    else if (!a.info) beep([700, .12, 500, .16]);
  }
  sosLayer.clearLayers();
  list.filter(a => a.kind === 'sos' && a.lat).forEach(a => L.marker([a.lat, a.lon], { icon: pinIcon('sos', 'shield'), zIndexOffset: 5000 }).addTo(sosLayer));
}

function renderStations(state) {
  $('#stations').innerHTML = CONFIG.stations.map(s => {
    const q = stationQueue(state, s.id);
    return `<div class="citem" data-st="${s.id}" style="padding:7px 0;border:0">
      <span class="no" style="background:${q.length ? 'var(--free)' : 'var(--pause)'}">${q.length}</span>
      <span class="grow"><div class="nm">${esc(s.name)}</div><div class="sub">${q.length ? q.map(c => c.plate.split(' ')[1]).join(' → ') : 'goală'}</div></span></div>`;
  }).join('');
  $$('#stations [data-st]').forEach(el => el.onclick = () => { const s = CONFIG.stations.find(x => x.id === el.dataset.st); map.setView([s.lat, s.lon], 16); });
}

function renderOrderPins(state) {
  orderLayer.clearLayers();
  for (const o of state.orders) {
    if (!['cautare', 'oferita', 'programata'].includes(o.status)) continue;
    const m = L.marker([o.pickup.lat, o.pickup.lon], { icon: pinIcon('order', 'person'), zIndexOffset: 3000, title: `#${o.code}` }).addTo(orderLayer);
    m.on('click', () => selectOrder(o.id));
  }
}

function smsNotices(state) {
  for (const o of state.orders) {
    if (o.source !== 'telefon' || o.status !== 'acceptata' || ui.smsSent.has(o.id)) continue;
    ui.smsSent.add(o.id);
    const car = carById(o.carId);
    if (car) toast(`SMS trimis la ${esc(o.client.phone)}: „Taxi ${esc(car.plate)} (${esc(car.model)}) ajunge în ${fmtMin(etaSeconds(car))}.”`, 'ok', 6000, 'message');
  }
}

// ---------- liste ----------
const activeStatuses = ['cautare', 'oferita', 'programata', 'acceptata', 'sosit', 'in_cursa'];
function renderLists() {
  const st = bus.state;
  const active = st.orders.filter(o => activeStatuses.includes(o.status));
  $('#cntO').textContent = active.length;
  $('#cntC').textContent = st.cars.filter(c => c.status !== STATUS.offline).length;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === ui.tab));
  let html = '';
  if (ui.tab === 'comenzi') {
    const order = { cautare: 0, oferita: 0, programata: 3, acceptata: 1, sosit: 1, in_cursa: 2 };
    const sorted = active.slice().sort((a, b) => order[a.status] - order[b.status] || (a.source === 'fundal') - (b.source === 'fundal') || b.createdAt - a.createdAt);
    html = sorted.length ? sorted.map(orderRow).join('') : '<p class="muted center" style="padding:30px">Nicio comandă activă.</p>';
  } else if (ui.tab === 'masini') {
    const groups = ['liber_statie', 'liber_drum', 'spre_client', 'cu_client', 'pauza', 'offline'];
    for (const g of groups) {
      const cars = st.cars.filter(c => carCategory(c) === g);
      if (!cars.length) continue;
      html += `<div class="cgroup"><span class="sw" style="background:${CAT_COLOR[g]}"></span>${CATEGORY_LABEL[g]} · ${cars.length}</div>`;
      html += cars.map(c => {
        const o = c.orderId ? orderById(c.orderId) : null;
        const sub = g === 'liber_statie' ? `Stația ${esc(CONFIG.stations.find(s => s.id === c.station)?.name || '')} · ${stationQueue(st, c.station).findIndex(x => x.id === c.id) + 1} la rând`
          : o ? `#${o.code} · ${esc(o.status === 'in_cursa' ? (o.dest || o.destInCar || {}).label || '' : o.pickup.label)} · ${fmtMin(etaSeconds(c))}`
          : g === 'liber_drum' && c.move ? 'Merge spre stație' : g === 'pauza' ? 'În pauză' : g === 'offline' ? 'Nu e în tură' : 'Liber';
        return `<div class="citem ${ui.selCar === c.id ? 'sel' : ''}" data-car="${c.id}"><span class="no" style="background:${CAT_COLOR[g]}">${esc(c.plate.split(' ')[1])}</span><span class="grow"><div class="nm">${esc(c.driver)}${c.human ? ' <span class="src app">APLICAȚIE</span>' : ''}</div><div class="sub">${sub}</div></span><span class="small muted">${c.earnings.rides} curse</span></div>`;
      }).join('');
    }
  } else {
    const done = st.orders.filter(o => ['finalizata', 'anulata'].includes(o.status)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, 60);
    html = done.length ? done.map(orderRow).join('') : '<p class="muted center" style="padding:30px">Încă nu sunt curse încheiate.</p>';
  }
  if (html !== ui.lastLists) {
    const sc = $('#list').scrollTop;
    $('#list').innerHTML = html; ui.lastLists = html; $('#list').scrollTop = sc;
    $$('#list [data-order]').forEach(el => el.onclick = () => selectOrder(el.dataset.order));
    $$('#list [data-car]').forEach(el => el.onclick = () => selectCar(el.dataset.car));
  }
}

function orderRow(o) {
  const car = o.carId ? carById(o.carId) : null;
  const srcLbl = { app: 'APP', telefon: 'TEL', fundal: 'APP' }[o.source];
  const when = o.status === 'programata' ? `programată ${fmtTime(o.scheduledFor)}` : fmtTime(o.createdAt);
  const extra = o.status === 'acceptata' && car ? ` · sosește în ${fmtMin(etaSeconds(car))}` : o.status === 'finalizata' ? ` · ${fmtMoney(o.fare)} lei ${o.payment === 'card' ? '(card)' : '(cash)'}` : '';
  return `<div class="oitem ${ui.selOrder === o.id ? 'sel' : ''}" data-order="${o.id}">
    <span class="code">#${o.code}</span>
    <span class="addr">${esc(o.pickup.label)}${o.dest ? ` → ${esc(o.dest.label)}` : ''}</span>
    <span class="os ${o.status}">${ORDER_LABEL[o.status]}</span>
    <div class="meta"><span class="src ${o.source === 'fundal' ? 'app' : o.source}">${srcLbl}</span><span>${esc(o.client.name)}</span><span>${when}</span>${car ? `<span><b>${esc(car.plate.split(' ')[1])}</b> ${esc(car.driver.split(' ')[0])}</span>` : ''}<span>${extra}</span></div>
  </div>`;
}

// ---------- detalii ----------
function selectOrder(id) { ui.selOrder = ui.selOrder === id ? null : id; ui.selCar = null; ui.lastLists = ''; renderLists(); renderDetail(true); fleet.update(bus.state); }
function selectCar(id) { ui.selCar = ui.selCar === id ? null : id; ui.selOrder = null; ui.lastLists = ''; if (ui.tab !== 'masini') ui.tab = 'masini'; renderLists(); renderDetail(true); fleet.update(bus.state); }

let detailKey = '';
function renderDetail(focus) {
  const box = $('#detail');
  const o = ui.selOrder ? orderById(ui.selOrder) : null;
  const car = ui.selCar ? carById(ui.selCar) : (o && o.carId ? carById(o.carId) : null);
  if (!o && !ui.selCar) { box.innerHTML = ''; detailKey = ''; route.clear(); return; }
  if (o) {
    const key = o.id + o.status + (o.carId || '') + (o.offer ? o.offer.carId : '') + Math.floor(Date.now() / 5000);
    if (key !== detailKey) {
      detailKey = key;
      const canAssign = ['cautare', 'oferita', 'programata'].includes(o.status);
      const cands = canAssign ? bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId).map(c => ({ c, d: dist(carPos(c).p, [o.pickup.lat, o.pickup.lon]) })).sort((a, b) => a.d - b.d).slice(0, 5) : [];
      const names = { creata: 'Comandă creată', oferita: 'Trimisă la', refuzata: 'Refuzată de', fara_raspuns: 'Fără răspuns de la', acceptata: 'Acceptată de', sosit: 'Șoferul a ajuns', in_cursa: 'Clientul a urcat', finalizata: 'Cursă terminată', card_incasat: 'Plată card încasată automat', cash_incasat: 'Cash încasat', anulata: 'Anulată', realocata: 'Realocată' };
      box.innerHTML = `<div class="detail">
        <div class="hd"><b style="font-size:1.1em">#${o.code}</b><span class="os ${o.status}">${ORDER_LABEL[o.status]}</span><button class="icon-btn flat" style="width:34px;height:34px;margin-left:auto" id="dClose">${icon('close', { size: 18 })}</button></div>
        <div><b>${esc(o.client.name)}</b> · ${esc(o.client.phone)}</div>
        <div class="small" style="margin-top:4px">${icon('person', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc(o.pickup.label)}</div>
        ${o.dest || o.destInCar ? `<div class="small">${icon('flag', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc((o.dest || o.destInCar).label)}${o.estimate ? ` · ${o.estimate.low}–${o.estimate.high} lei` : ''}</div>` : ''}
        <div class="small muted" style="margin-top:4px">${o.payment === 'card' ? `Card ${esc(o.card ? '•••• ' + o.card.last4 : '')}` : 'Cash'}${o.note ? ` · „${esc(o.note)}”` : ''}${Object.entries(o.options || {}).filter(x => x[1]).length ? ' · ' + Object.entries(o.options).filter(x => x[1]).map(([k]) => ({ bigTrunk: 'portbagaj mare', pet: 'animal', childSeat: 'scaun copil', help: 'ajutor la urcare' }[k])).join(', ') : ''}</div>
        ${o.offer ? `<div class="small" style="margin-top:6px;color:var(--danger);font-weight:700">Așteaptă răspuns de la ${esc(carById(o.offer.carId)?.driver || '')}…</div>` : ''}
        ${canAssign ? `<div class="small" style="margin-top:10px;font-weight:800">Alocă manual (cele mai apropiate libere):</div>${cands.map(x => `<button class="cand" data-assign="${x.c.id}"><span class="no" style="background:var(--free);color:#fff;font-weight:900;border-radius:8px;padding:4px 8px">${esc(x.c.plate.split(' ')[1])}</span><span class="grow"><b>${esc(x.c.driver)}</b>${x.c.human ? ' <span class="src app">APP</span>' : ''}<div class="small muted">${fmtKm(x.d)}${x.c.station ? ' · în stație' : ''}${x.c.big ? ' · combi' : ''}</div></span>${icon('chevron', { size: 18 })}</button>`).join('') || '<div class="small muted">Nicio mașină liberă acum.</div>'}` : ''}
        <ul class="timeline">${o.timeline.map(t => `<li><b>${fmtTime(t.t)}</b><span>${names[t.s] || t.s}${t.car ? ' ' + esc(carById(t.car)?.driver || '') : ''}${t.fare ? ` · ${fmtMoney(t.fare)} lei` : ''}</span></li>`).join('')}</ul>
        ${activeStatuses.includes(o.status) ? `<button class="btn sm danger-soft block" style="margin-top:10px" id="dCancel">Anulează comanda</button>` : ''}
      </div>`;
      $('#dClose').onclick = () => selectOrder(o.id);
      $$('[data-assign]', box).forEach(b => b.onclick = () => { bus.act('assign', { orderId: o.id, carId: b.dataset.assign }); toast(`Comanda #${o.code} trimisă la ${esc(carById(b.dataset.assign).driver)}`, 'ok', 2500); });
      const dc = $('#dCancel', box); if (dc) dc.onclick = async () => { if (await confirmBox(`Anulezi comanda #${o.code}?`, 'Clientul și șoferul vor fi anunțați.', { yes: 'Anulează', danger: true })) bus.act('cancelOrder', { orderId: o.id, by: 'dispecer', reason: 'Anulată de dispecerat' }); };
    }
    if (focus) {
      const pts = [[o.pickup.lat, o.pickup.lon]];
      if (car) pts.push(carPos(car).p);
      if (o.dest) pts.push([o.dest.lat, o.dest.lon]);
      map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 16 });
    }
  } else {
    const c = carById(ui.selCar);
    const key = c.id + c.status + (c.orderId || '') + (c.station || '');
    if (key !== detailKey) {
      detailKey = key;
      const cat = carCategory(c);
      const o2 = c.orderId ? orderById(c.orderId) : null;
      box.innerHTML = `<div class="detail">
        <div class="hd"><span class="no" style="background:${CAT_COLOR[cat]};color:#fff;font-weight:900;border-radius:8px;padding:4px 8px">${esc(c.plate.split(' ')[1])}</span><b>${esc(c.driver)}</b><span class="pill st-${cat}">${CATEGORY_LABEL[cat]}</span><button class="icon-btn flat" style="width:34px;height:34px;margin-left:auto" id="dClose">${icon('close', { size: 18 })}</button></div>
        <div class="small">${esc(c.plate)} · ${esc(c.model)} ${esc(c.color)} · ★ ${c.rating.toLocaleString('ro-RO')} · ${c.years} ani experiență</div>
        <div class="grid3" style="margin-top:10px">
          <div class="stat" style="background:var(--surface)"><div class="k">Curse azi</div><div class="v">${c.earnings.rides}</div></div>
          <div class="stat" style="background:var(--surface)"><div class="k">Cash</div><div class="v">${Math.round(c.earnings.cash)}</div></div>
          <div class="stat" style="background:var(--surface)"><div class="k">Card</div><div class="v">${Math.round(c.earnings.card)}</div></div>
        </div>
        ${o2 ? `<button class="cand" data-gotoorder="${o2.id}" style="margin-top:10px"><span class="os ${o2.status}">${ORDER_LABEL[o2.status]}</span><span class="grow"><b>#${o2.code}</b> ${esc(o2.pickup.label)}</span>${icon('chevron', { size: 18 })}</button>` : ''}
        <div class="f2" style="margin-top:10px"><button class="btn sm block" id="dCall">${icon('phone', { size: 18 })}Sună șoferul</button><button class="btn sm block" id="dFocus">${icon('locate', { size: 18 })}Arată pe hartă</button></div>
      </div>`;
      $('#dClose').onclick = () => selectCar(c.id);
      $('#dCall').onclick = () => toast(`Se apelează ${esc(c.driver)} prin stația radio / telefon…`, '', 3000, 'phone');
      $('#dFocus').onclick = () => map.setView(carPos(c).p, 16);
      const go = $('[data-gotoorder]', box); if (go) go.onclick = () => { ui.tab = 'comenzi'; selectOrder(go.dataset.gotoorder); };
    }
    if (focus) map.setView(carPos(c).p, Math.max(map.getZoom(), 15));
  }
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
  const key = fPhone.value.replace(/\D/g, '');
  const c = bus.state.clients[key];
  $('#known').innerHTML = c ? `<div class="known">${icon('user', { size: 18 })}<div><b>${esc(c.name)}</b> · ${c.rides} curse<div class="small">Ultima adresă: ${esc(c.last ? c.last.address : '—')}</div></div><button type="button" class="btn sm dark" id="useKnown">Folosește</button></div>` : '';
  const uk = $('#useKnown'); if (uk) uk.onclick = () => { fName.value = c.name; if (c.last) setFormPlace('pickup', { lat: c.last.lat, lon: c.last.lon, label: c.last.address }); };
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
    const est = estimateFare(cityMap.route([p.lat, p.lon], [d.lat, d.lon]).meters);
    $('#fEst').innerHTML = `Estimat: <b>${est.low}–${est.high} lei</b> · ${est.km.toLocaleString('ro-RO')} km`;
  } else $('#fEst').textContent = '';
}

// alegere pe hartă
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
addEventListener('keydown', e => { if (e.key === 'Escape') stopPick(); });

function buildOrder(forceCar) {
  const phone = fPhone.value.trim(), name = fName.value.trim() || 'Client';
  if (!ui.form.pickup) { toast('Alege adresa de preluare din listă sau de pe hartă.', 'warn'); fPickup.focus(); return null; }
  if (phone.replace(/\D/g, '').length < 9) { toast('Introdu numărul de telefon al clientului.', 'warn'); fPhone.focus(); return null; }
  const options = {}; $$('[data-o]').forEach(c => { if (c.checked) options[c.dataset.o] = true; });
  let scheduledFor = null;
  if ($('#fWhen').value) {
    const [hh, mm] = $('#fWhen').value.split(':').map(Number);
    const d = new Date(); d.setHours(hh, mm, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    scheduledFor = d.getTime();
  }
  const p = ui.form.pickup, d = ui.form.dest;
  return {
    id: uid('o'), source: 'telefon', client: { name, phone }, pickup: p, dest: d, options, note: $('#fNote').value.trim(), payment: 'cash',
    estimate: d ? estimateFare(cityMap.route([p.lat, p.lon], [d.lat, d.lon]).meters) : null, scheduledFor, forceCar,
  };
}
function resetForm() {
  $('#phoneForm').reset(); $('#known').innerHTML = ''; ui.form = { pickup: null, dest: null }; updateFormMarkers();
}
$('#phoneForm').onsubmit = e => {
  e.preventDefault();
  const o = buildOrder(null); if (!o) return;
  bus.act('createOrder', o);
  toast(o.scheduledFor ? `Precomandă salvată pentru ${fmtTime(o.scheduledFor)}` : 'Comanda a fost trimisă la cel mai potrivit șofer', 'ok', 3000);
  resetForm(); ui.tab = 'comenzi'; ui.selOrder = o.id; ui.lastLists = '';
};
$('#pickCarBtn').onclick = () => {
  const o = buildOrder(null); if (!o) return;
  const cands = bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId).map(c => ({ c, d: dist(carPos(c).p, [o.pickup.lat, o.pickup.lon]) })).sort((a, b) => a.d - b.d).slice(0, 8);
  const ov = modal(`
    <div class="panel-head"><h2>Alege mașina</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin-top:-6px">Mașini libere, de la cea mai apropiată de ${esc(o.pickup.label)}.</p>
    ${cands.map(x => `<button class="cand" data-c="${x.c.id}" style="background:var(--surface-2)"><span style="background:var(--free);color:#fff;font-weight:900;border-radius:8px;padding:4px 8px">${esc(x.c.plate.split(' ')[1])}</span><span class="grow"><b>${esc(x.c.driver)}</b><div class="small muted">${fmtKm(x.d)} · ${x.c.station ? 'Stația ' + esc(CONFIG.stations.find(s => s.id === x.c.station)?.name || '') : 'pe drum'}${x.c.big ? ' · combi' : ''}</div></span>${icon('chevron')}</button>`).join('') || '<p class="muted">Nicio mașină liberă acum. Trimite automat – intră la rând.</p>'}
  `);
  $$('[data-c]', ov).forEach(b => b.onclick = () => {
    o.forceCar = b.dataset.c; bus.act('createOrder', o); ov.close();
    toast(`Comanda trimisă la ${esc(carById(b.dataset.c).driver)}`, 'ok'); resetForm(); ui.tab = 'comenzi'; ui.selOrder = o.id; ui.lastLists = '';
  });
};

// ---------- pornire ----------
bus.on(onState);
boot.done();
