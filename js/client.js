// Aplicația CLIENT
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, estimateFare, perKm, etaSeconds, remainingRoute, uid, STATUS, colorCat, CATEGORY_LABEL, pauseLeft, carHas, carCapsList, reqOptions, optionLabel, phoneKey, initials } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, legendHtml, cssVar, carSvg } from './mapview.js';
import { icon } from './icons.js';
import { mountCalls } from './calls.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtClock, fmtMoney, firstName, beep, vibrate, store, applyTextSize, loadingScreen, unlockAudio, avatar, pickPhoto, swipeHtml, bindSwipe } from './ui.js';

const L = window.L;
const T = CONFIG.tariff;
const boot = loadingScreen();
unlockAudio();

let profile = store.get('client-profile', null);
applyTextSize(profile && profile.big);
document.title = CONFIG.company.name;

let cityMap, bus, map, fleet, route, pickupMk, destMk, calls;
const ui = {
  screen: 'home', pickup: null, dest: null, payment: 'cash', options: {}, note: '', scheduledFor: null, requestCar: null, quickRoute: null,
  collapsed: false, lastKey: '', lastStatus: null, chatSeen: 0, lastMsgT: 0, done: {}, popupShown: {}, schedSeen: {},
};

try {
  cityMap = await CityMap.load();
} catch (e) { boot.fail('Nu am putut încărca harta. Verifică internetul.'); throw e; }

const app = $('#app');
map = createMap($('#map'), { cityMap });
route = new RouteLine(map, cssVar('--ink'));
bus = await connect(cityMap, { role: 'client' });
window.taxiDemo = bus; window.__map = map;

fleet = new FleetLayer(map, {
  me: null,
  dim: car => { const o = currentOrder(); return !!(o && o.carId && car.id !== o.carId && ['acceptata', 'sosit', 'in_cursa'].includes(o.status)); },
  filter: car => car.status !== STATUS.offline,
  onCar: id => openCarCard(id),
  onFrame: frame,
});

// ---------- structura paginii ----------
app.insertAdjacentHTML('beforeend', `
  <div class="topbar">
    <button class="icon-btn" id="menuBtn" aria-label="Meniu">${icon('menu')}</button>
    <div class="brand-pill"><span class="logo">${icon('car', { size: 20 })}</span>${esc(CONFIG.company.name)}</div>
  </div>
  <div class="legend-wrap"><div class="legend" id="legend"></div></div>
  <button class="icon-btn fab-locate" id="locateBtn" aria-label="Locația mea">${icon('locate')}</button>
  <div class="sheet client-sheet" id="sheet">
    <button class="grab-btn" id="grab" aria-label="Coboară sau ridică panoul"><span class="grab"></span></button>
    <div id="sheetBody"></div>
  </div>
  <div class="demo-badge">DEMO · viteză x<span id="spd">1</span></div>
`);
const sheet = $('#sheet'), body = $('#sheetBody');
$('#menuBtn').onclick = openMenu;
$('#locateBtn').onclick = () => useMyLocation(true);
setupSheetDrag();

const lastPickup = store.get('client-last-pickup', null);
ui.payment = profile && profile.card ? 'card' : 'cash';
ui.pickup = lastPickup || { ...CONFIG.demoClient.home, label: CONFIG.demoClient.home.address, kind: 'saved' };

calls = mountCalls(bus, { role: 'client', id: () => profile ? phoneKey(profile.phone) : null, name: () => profile ? profile.name : '' }, {
  label: p => p.role === 'sofer' ? (bus.state.cars.find(c => c.id === p.id) || {}).driver + ' · șofer' : p.role === 'dispecer' ? 'Dispecerat ' + CONFIG.company.short : p.name,
  photo: p => p.role === 'sofer' ? (bus.state.cars.find(c => c.id === p.id) || {}).photo : null,
});

// ---------- panou glisant ----------
function setCollapsed(v) {
  ui.collapsed = v;
  sheet.classList.toggle('collapsed', v);
  requestAnimationFrame(layoutAround);
}
function setupSheetDrag() {
  const grab = $('#grab');
  let y0 = null, moved = false;
  const start = e => { y0 = e.clientY; moved = false; };
  const move = e => { if (y0 === null) return; const dy = e.clientY - y0; if (Math.abs(dy) > 8) moved = true; if (dy > 0 && !ui.collapsed) sheet.style.transform = `translateY(${Math.min(dy, 220)}px)`; if (dy < 0 && ui.collapsed) sheet.style.transform = `translateY(${Math.max(dy, -60)}px)`; };
  const end = e => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null; sheet.style.transform = '';
    if (!moved) { setCollapsed(!ui.collapsed); return; }
    if (dy > 50) setCollapsed(true); else if (dy < -30) setCollapsed(false);
  };
  for (const el of [grab]) {
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); start(e); });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { y0 = null; sheet.style.transform = ''; });
  }
  // tragere și de pe zona de sus a panoului (titlul)
  body.addEventListener('pointerdown', e => { if (e.target.closest('.peek') && !e.target.closest('button, a, input')) { start(e); body.setPointerCapture(e.pointerId); } });
  body.addEventListener('pointermove', move);
  body.addEventListener('pointerup', e => { if (y0 !== null) end(e); });
}

// ---------- stare ----------
function currentOrder() {
  const id = store.get('client-order', null);
  if (!id || !bus.state) return null;
  return bus.state.orders.find(o => o.id === id) || null;
}
function myCar(o = currentOrder()) { return o && o.carId ? bus.state.cars.find(c => c.id === o.carId) : null; }
const carById = id => bus.state.cars.find(c => c.id === id);
const scheduledIds = () => store.get('client-scheduled', []);
const scheduledOrders = () => scheduledIds().map(id => bus.state.orders.find(o => o.id === id)).filter(o => o && o.status === 'programata');

function screenFor(o) {
  if (!o) return ui.screen;
  switch (o.status) {
    case 'cautare': case 'oferita': return 'searching';
    case 'acceptata': return 'assigned';
    case 'sosit': return 'arrived';
    case 'in_cursa': return 'inride';
    case 'finalizata': return 'done';
    case 'anulata': return o.cancelledBy === 'client' ? 'home' : 'cancelled';
  }
  return 'home';
}

function onState(state) {
  if (!state) return;
  $('#spd').textContent = state.speedMul;
  fleet.update(state);
  let o = currentOrder();
  if (o && o.status === 'anulata' && o.cancelledBy === 'client') { store.set('client-order', null); o = null; }
  if (!o && store.get('client-order', null)) store.set('client-order', null);
  watchScheduled(state);
  o = currentOrder();
  if (o && ui.lastStatus && o.status !== ui.lastStatus) notifyStatus(o, ui.lastStatus);
  ui.lastStatus = o ? o.status : null;
  if (o) {
    const msgs = (state.chats[o.id] || []).filter(m => m.from !== 'client');
    const m = msgs[msgs.length - 1];
    if (m && m.t > ui.lastMsgT && !document.querySelector('.overlay.chat-ov')) {
      ui.lastMsgT = m.t;
      toast(`<b>${esc(firstName(myCar(o)?.driver || 'Șoferul'))}:</b> ${esc(m.text)}`, '', 4500, 'message'); beep([990, .1]); vibrate(80);
    }
  }
  render();
}

// comenzile programate: confirmări și pornire la ora stabilită
function watchScheduled(state) {
  const ids = scheduledIds();
  if (!ids.length) return;
  const keep = [];
  for (const id of ids) {
    const o = state.orders.find(x => x.id === id);
    if (!o) continue;
    const seen = ui.schedSeen[id] || {};
    if (o.request && o.request.status !== 'pending' && seen.req !== o.request.status) {
      const car = carById(o.request.carId);
      if (seen.req !== undefined || o.request.answeredAt > Date.now() - 15000) {
        if (o.request.status === 'accepted') { toast(`${esc(car ? car.driver : 'Șoferul')} (${car ? car.cs : ''}) a acceptat cursa de la ${fmtTime(o.scheduledFor)}.`, 'ok', 5000, 'check'); beep([660, .1, 990, .15]); }
        else toast(`${esc(car ? firstName(car.driver) : 'Șoferul')} nu poate prelua cursa. La ${fmtTime(o.scheduledFor)} trimitem cel mai apropiat taxi.`, 'warn', 6000);
      }
      seen.req = o.request.status;
    } else if (o.request && seen.req === undefined) seen.req = o.request.status;
    if (o.reservedBy && seen.res !== o.reservedBy && !o.request) {
      if (seen.res !== undefined) { const car = carById(o.reservedBy); toast(`Cursa ta din ${dayLabel(o.scheduledFor)} a fost preluată din timp de ${esc(car ? car.driver : '')} (${car ? car.cs : ''}).`, 'ok', 5000, 'calendar'); }
      seen.res = o.reservedBy;
    } else if (seen.res === undefined) seen.res = o.reservedBy || null;
    ui.schedSeen[id] = seen;
    if (o.status === 'programata') { keep.push(id); continue; }
    if (['anulata', 'finalizata'].includes(o.status)) continue;
    // a pornit: devine comanda curentă (dacă nu e alta în desfășurare)
    if (!currentOrder()) { store.set('client-order', id); ui.lastStatus = o.status; ui.chatSeen = 0; toast('A început cursa programată.', 'ok', 4000, 'calendar'); }
    else keep.push(id);
  }
  store.set('client-scheduled', keep);
}

function notifyStatus(o, prev) {
  const car = myCar(o);
  if (o.status === 'acceptata') {
    beep([660, .1, 990, .15]); vibrate([60, 40, 60]);
    if (!ui.popupShown[o.id]) { ui.popupShown[o.id] = true; setTimeout(() => showAcceptedPopup(o), 120); }
  }
  if ((o.status === 'cautare' || o.status === 'oferita') && prev === 'oferita' && o.requestCar === null && ui.requestedName) {
    toast(`${esc(ui.requestedName)} nu poate prelua acum. Căutăm cel mai apropiat taxi.`, 'warn', 4500); ui.requestedName = null;
  }
  if (o.status === 'sosit') { toast('Taxiul a ajuns și te așteaptă.', 'ok', 5000, 'pin'); beep([880, .15, 880, .15, 1320, .25], .25); vibrate([200, 100, 200]); }
  if (o.status === 'finalizata') beep([1320, .12, 990, .18]);
  if (o.status === 'anulata' && o.cancelledBy !== 'client') { toast('Comanda a fost anulată.', 'bad'); vibrate(200); }
}

// ---------- randare ----------
function render() {
  if (!profile) return;
  const o = currentOrder();
  const scr = screenFor(o);
  const key = [scr, o ? o.id + o.status + (o.carId || '') + (o.tip ? 't' : '') + (o.sos && o.sos.active ? 's' : '') : '', ui.pickup && ui.pickup.label, ui.dest && ui.dest.label, ui.payment,
    JSON.stringify(ui.options), ui.scheduledFor, ui.requestCar, profile.card ? profile.card.last4 : '', (profile.routes || []).length, scheduledOrders().length,
    ui.quickRoute && ui.quickRoute.name, ui.optsOpen].join('|');
  if (key !== ui.lastKey) {
    const prevScr = ui.lastKey.split('|')[0];
    ui.lastKey = key;
    body.innerHTML = SCREENS[scr](o);
    bindCommon();
    BIND[scr] && BIND[scr](o);
    if (prevScr !== scr) { updateMapForScreen(scr, o); if (['searching', 'assigned', 'arrived', 'inride', 'done', 'confirm', 'quick'].includes(scr) && prevScr) setCollapsed(false); }
    else updateMapForScreen(scr, o, true);
    requestAnimationFrame(layoutAround);
  }
  refreshDynamic(scr, o);
}

function layoutAround() {
  const sh = sheet.getBoundingClientRect();
  const wide = innerWidth >= 900;
  $('#locateBtn').style.bottom = wide ? '24px' : (innerHeight - sh.top + 14) + 'px';
  $('#locateBtn').hidden = ['inride', 'done'].includes(screenFor(currentOrder()));
}

function fitTo(points) {
  if (!points.length) return;
  const sh = sheet.getBoundingClientRect();
  const wide = innerWidth >= 900;
  // zona vizibilă a hărții: între bara de sus și panou (cel puțin 150 px)
  const top = 110, bottom = Math.min(innerHeight - sh.top + 24, innerHeight - top - 150);
  const opts = wide
    ? { paddingTopLeft: [480, 90], paddingBottomRight: [60, 60], maxZoom: 16, animate: true }
    : { paddingTopLeft: [40, top], paddingBottomRight: [40, Math.max(40, bottom)], maxZoom: 16, animate: true };
  if (points.length === 1) map.fitBounds(L.latLng(points[0]).toBounds(500), opts);
  else map.fitBounds(L.latLngBounds(points), opts);
}

function updateMapForScreen(scr, o, soft = false) {
  const pickup = o ? o.pickup : (scr === 'quick' && ui.quickRoute ? ui.quickRoute.from : ui.pickup);
  const dest = o ? (o.dest || o.destInCar) : (scr === 'quick' && ui.quickRoute ? ui.quickRoute.to : ui.dest);
  if (pickup && scr !== 'inride' && scr !== 'done' && scr !== 'pickmap') {
    if (!pickupMk) pickupMk = L.marker([pickup.lat, pickup.lon], { icon: pinIcon('pickup', 'person'), zIndexOffset: 2000, keyboard: false }).addTo(map);
    pickupMk.setLatLng([pickup.lat, pickup.lon]);
  } else if (pickupMk) { map.removeLayer(pickupMk); pickupMk = null; }
  if (dest && ['confirm', 'quick', 'inride', 'searching', 'assigned', 'arrived'].includes(scr)) {
    if (!destMk) destMk = L.marker([dest.lat, dest.lon], { icon: pinIcon('dest', 'flag'), zIndexOffset: 1900, keyboard: false }).addTo(map);
    destMk.setLatLng([dest.lat, dest.lon]);
  } else if (destMk) { map.removeLayer(destMk); destMk = null; }

  fleet.opts.me = o && o.carId ? o.carId : null;
  fleet.update(bus.state);
  route.setDashed(false);
  if ((scr === 'confirm' || scr === 'quick') && pickup && dest) {
    const r = cityMap.route([pickup.lat, pickup.lon], [dest.lat, dest.lon]);
    route.set(r.pts, cssVar('--ink'));
    if (!soft) fitTo(r.pts);
  } else if (scr === 'home' || scr === 'confirm' || scr === 'searching') {
    route.clear();
    if (!soft) { const near = freeCarsNear(pickup, 1800).slice(0, 3).map(c => carPos(c).p); fitTo([[pickup.lat, pickup.lon], ...near]); }
  } else if (scr === 'assigned' || scr === 'arrived' || scr === 'inride') {
    const car = myCar(o);
    if (car) {
      const pts = remainingRoute(car);
      route.set(pts, scr === 'inride' ? cssVar('--busy') : cssVar('--to'));
      if (!soft) fitTo(pts.length > 1 ? pts : [carPos(car).p, [pickup.lat, pickup.lon]]);
    }
  } else route.clear();
}

let lastDyn = 0, lastRoute = 0;
function frame(now) {
  if (now - lastDyn > 500) { lastDyn = now; const o = currentOrder(); refreshDynamic(screenFor(o), o); }
  if (now - lastRoute > 1200) {
    lastRoute = now;
    const o = currentOrder(); const car = myCar(o);
    if (car && o && ['acceptata', 'in_cursa'].includes(o.status)) route.set(remainingRoute(car));
  }
}

function freeCarsNear(p, radius = 3000) {
  if (!bus.state || !p) return [];
  return bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId)
    .map(c => ({ c, d: dist(carPos(c).p, [p.lat, p.lon]) }))
    .filter(x => x.d <= radius).sort((a, b) => a.d - b.d).map(x => x.c);
}
function etaToMe(car, p = ui.pickup) {
  const d = dist(carPos(car).p, [p.lat, p.lon]) * 1.35;
  return d / (CONFIG.demo.avgSpeedKmh / 3.6 * (bus.state.speedMul || 1)) + 30;
}
function nearestEtaSec(p) { const cars = freeCarsNear(p, 8000); return cars.length ? etaToMe(cars[0], p) : null; }

function refreshDynamic(scr, o) {
  const st = bus.state; if (!st) return;
  const counts = {};
  for (const c of st.cars) { if (c.status === STATUS.offline) continue; const k = colorCat(c); counts[k] = (counts[k] || 0) + 1; }
  const lg = $('#legend'); const html = legendHtml(counts, innerWidth < 380);
  if (lg.dataset.h !== html) { lg.innerHTML = html; lg.dataset.h = html; }
  lg.parentElement.hidden = !(['home', 'confirm', 'quick'].includes(scr) || ui.collapsed);

  const near = $('[data-near]');
  if (near && ui.pickup) {
    const n = freeCarsNear(ui.pickup, 2500).length;
    const eta = nearestEtaSec(ui.pickup);
    near.innerHTML = n ? `<span class="live"></span>${n} ${n === 1 ? 'taxi liber' : 'taxiuri libere'} aproape · cel mai apropiat în ${fmtMin(eta)}` : `<span class="live" style="background:var(--warn)"></span>Toate mașinile sunt ocupate acum. Comanda intră la rând.`;
  }
  const car = myCar(o);
  $$('[data-eta]').forEach(el => { if (car) el.textContent = String(Math.max(1, Math.round(etaSeconds(car) / 60))); });
  $$('[data-arrive-at]').forEach(el => { if (car) el.textContent = fmtTime(Date.now() + etaSeconds(car) * 1000); });
  $$('[data-wait]').forEach(el => {
    if (!o || !o.arrivedAt) return;
    const freeSec = T.freeWaitMin * 60 - (Date.now() - o.arrivedAt) / 1000 * st.speedMul;
    el.innerHTML = freeSec > 0 ? `Așteptare gratuită: <b>${fmtClock(freeSec)}</b>` : `Se taxează așteptarea: ${fmtMoney(T.perMinWait)} lei/min`;
  });
  $$('[data-search-t]').forEach(el => { if (o) el.textContent = fmtClock((Date.now() - o.createdAt) / 1000); });
  if (o) {
    const unread = (st.chats[o.id] || []).filter(m => m.from !== 'client').length - ui.chatSeen;
    $$('[data-unread]').forEach(el => { el.hidden = unread <= 0; el.textContent = unread; });
  }
}

// ---------- ecrane ----------
const peek = (title, right = '', sub = '') => `<div class="peek"><div class="grow"><div class="pk-t">${title}</div>${sub ? `<div class="pk-s">${sub}</div>` : ''}</div>${right}</div>`;
const sameDay = t => new Date(t).toDateString() === new Date().toDateString();
const dayLabel = t => { const d = new Date(t), n = new Date(); const diff = Math.round((new Date(d.toDateString()) - new Date(n.toDateString())) / 86400e3); return diff === 0 ? 'azi' : diff === 1 ? 'mâine' : diff === 2 ? 'poimâine' : d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'short' }); };

const SCREENS = {
  home() {
    const saved = profile.saved || {};
    const routes = profile.routes || [];
    const sch = scheduledOrders();
    return `
      ${peek(`Unde mergem, ${esc(firstName(profile.name))}?`, `<button class="icon-btn flat sm-btn" data-collapse aria-label="Coboară panoul">${icon('chevron', { size: 20 })}</button>`)}
      <div class="main">
        <div class="where-stack">
          <button class="where" data-pick="pickup"><span class="dot"></span><span class="grow"><span class="lbl">Te luăm de la</span><div class="val">${esc(ui.pickup.label)}</div></span><span class="muted small">Schimbă</span></button>
          <button class="where" data-pick="dest"><span class="dot dest"></span><span class="grow"><span class="lbl">Destinație (opțional)</span><div class="val muted">Caută adresa sau locul</div></span>${icon('search', { cls: 'muted' })}</button>
        </div>
        <div class="chips mt">
          ${saved.home ? `<button class="chip" data-quick="home">${icon('home', { size: 20 })}Acasă</button>` : ''}
          ${saved.work ? `<button class="chip" data-quick="work">${icon('work', { size: 20 })}Serviciu</button>` : ''}
          <button class="chip accent" id="routesBtn">${icon('route', { size: 20 })}Rute salvate${routes.length ? ` <b>${routes.length}</b>` : ''}</button>
          ${sch.length ? `<button class="chip" id="schedBtn">${icon('calendar', { size: 20 })}Programate <b>${sch.length}</b></button>` : ''}
        </div>
        <div class="near" data-near></div>
        <button class="btn primary block xl big-cta" id="orderHere">${icon('car', { size: 26 })}Vreau taxi aici</button>
        <button class="linkbtn" id="planBtn" style="text-decoration:none;color:var(--ink-2)">${icon('calendar', { size: 18 }).replace('class="ic ', 'style="display:inline;vertical-align:-3px;margin-right:6px" class="ic ')}Programează o cursă pentru altă zi</button>
      </div>`;
  },

  confirm() {
    const est = ui.dest ? ui.estimate : null;
    const rc = ui.requestCar ? carById(ui.requestCar) : null;
    const routeSaved = ui.dest && (profile.routes || []).some(r => sameRoute(r, ui.pickup, ui.dest));
    const when = ui.scheduledFor ? `${cap(dayLabel(ui.scheduledFor))}, ${fmtTime(ui.scheduledFor)}` : 'Acum';
    const nOpts = reqOptions(ui.options).length;
    return `
      ${peek('Confirmă comanda', `<button class="icon-btn flat sm-btn" data-back aria-label="Înapoi">${icon('close', { size: 20 })}</button>`, est ? `${est.low}–${est.high} lei · ${ui.payment === 'card' ? 'card' : 'cash'}` : '')}
      <div class="main">
        ${rc ? `<div class="req-chip"><span class="mini-car ${colorCat(rc)}">${carSvg(colorCat(rc), 26)}</span><div class="grow"><b>Cu ${esc(rc.driver)} · ${rc.cs}</b><div class="small muted">${ui.scheduledFor ? `Când își termină pauza (${fmtTime(ui.scheduledFor)})` : 'Comanda merge direct la acest șofer'}</div></div><button class="icon-btn flat sm-btn" id="reqClear" aria-label="Renunță la șoferul ales">${icon('close', { size: 18 })}</button></div>` : ''}
        <div class="where-stack">
          <button class="where" data-pick="pickup"><span class="dot"></span><span class="grow"><span class="lbl">De la</span><div class="val">${esc(ui.pickup.label)}</div></span>${icon('chevron', { cls: 'muted', size: 20 })}</button>
          <button class="where" data-pick="dest"><span class="dot dest"></span><span class="grow"><span class="lbl">Până la</span><div class="val ${ui.dest ? '' : 'muted'}">${ui.dest ? esc(ui.dest.label) : 'Spui șoferului în mașină'}</div></span>${icon('chevron', { cls: 'muted', size: 20 })}</button>
        </div>
        ${ui.dest ? `<button class="save-route ${routeSaved ? 'on' : ''}" id="saveRoute">${icon('star', { size: 18 })}${routeSaved ? 'Rută salvată' : 'Salvează ruta pentru data viitoare'}</button>` : ''}
        <div class="estimate">
          ${est
            ? `<div><div class="small muted" style="font-weight:700">Preț estimat</div><div class="price">${est.low}–${est.high} lei</div></div><div class="meta">${est.km.toLocaleString('ro-RO')} km<br>~${est.minutes} min cu traficul</div>`
            : `<div><div class="small muted" style="font-weight:700">Plătești după taximetru</div><div class="price" style="font-size:1.35em">${fmtMoney(perKm())} lei/km</div></div><div class="meta">Pornire ${fmtMoney(T.start)} lei<br>Adaugă destinația<br>pentru preț estimat</div>`}
        </div>
        ${paySeg()}
        <label class="field mt"><span>${icon('pin', { size: 16 }).replace('class="ic ', 'style="display:inline;vertical-align:-3px" class="ic ')} Reper / indicații pentru șofer</span><input class="input" id="note" placeholder="ex. Bloc B2, scara 3, lângă farmacie" value="${esc(ui.note)}"></label>
        <button class="more-btn ${ui.optsOpen ? 'open' : ''}" id="moreBtn">${icon('plus', { size: 20 })}<span class="grow">Mai multe opțiuni${nOpts ? ` <b class="cnt">${nOpts}</b>` : ''}<span class="small muted" style="display:block;font-weight:600">Scaun copil, portbagaj mare, ajutor la urcare</span></span>${icon('chevron', { size: 20 })}</button>
        ${ui.optsOpen ? `<div class="opts mt">${CONFIG.options.map(op => `<button class="opt ${ui.options[op.key] ? 'on' : ''}" data-opt="${op.key}">${icon(op.icon, { size: 24 })}<span class="grow">${op.label}${op.hint ? `<span class="small muted" style="display:block;font-weight:600">${op.hint}</span>` : ''}</span><span class="ck">${icon('check', { size: 16, stroke: 3 })}</span></button>`).join('')}</div>
          <p class="small muted" style="margin:8px 2px 0">${icon('info', { size: 16 }).replace('class="ic ', 'style="display:inline;vertical-align:-3px" class="ic ')} Mașinile care au aceste dotări primesc comanda primele.</p>` : ''}
        <div class="hstack mt wrap">
          <button class="chip" id="whenBtn">${icon('clock', { size: 20 })}${when}</button>
          ${ui.scheduledFor && !rc ? `<button class="chip" id="whenClear">${icon('close', { size: 18 })}Acum</button>` : ''}
        </div>
        <div class="mt">${swipeHtml(ui.scheduledFor ? 'Glisează ca să programezi' : 'Glisează ca să comanzi')}</div>
      </div>`;
  },

  // comandă rapidă dintr-o rută salvată: plata + glisează
  quick() {
    const r = ui.quickRoute;
    const est = ui.estimate;
    return `
      ${peek(esc(r.name), `<button class="icon-btn flat sm-btn" data-back aria-label="Înapoi">${icon('close', { size: 20 })}</button>`, 'Rută salvată')}
      <div class="main">
        <div class="route-card">
          <div class="rc-line"><span class="dot"></span><span class="grow">${esc(r.from.label)}</span></div>
          <div class="rc-line"><span class="dot dest"></span><span class="grow">${esc(r.to.label)}</span></div>
          <div class="rc-est"><b>${est.low}–${est.high} lei</b><span>${est.km.toLocaleString('ro-RO')} km · ~${est.minutes} min</span></div>
        </div>
        <h3 style="margin:12px 0 8px">Cum plătești?</h3>
        ${paySeg(true)}
        <div class="mt">${swipeHtml()}</div>
        <button class="linkbtn" id="quickEdit">Modifică opțiunile sau ora</button>
      </div>`;
  },

  searching(o) {
    return `
      ${peek('Căutăm cel mai apropiat taxi', '', `Aștepți de <b data-search-t>0:00</b>`)}
      <div class="main">
        <div class="radar"><div class="core">${icon('car', { size: 30 })}</div></div>
        <div class="wait-big"><span class="muted">Aștepți de</span><b data-search-t>0:00</b></div>
        <p class="center muted" style="margin:0 0 6px">${o.requestCar ? 'Am trimis comanda șoferului ales.' : reqOptions(o.options).length ? `Alertăm întâi mașinile cu ${reqOptions(o.options).map(optionLabel).join(', ').toLowerCase()}.` : 'De obicei durează câteva secunde.'}</p>
        <div class="where-stack mt">
          <div class="where"><span class="dot"></span><span class="grow"><span class="lbl">De la</span><div class="val">${esc(o.pickup.label)}</div></span></div>
          ${o.dest ? `<div class="where"><span class="dot dest"></span><span class="grow"><span class="lbl">Până la</span><div class="val">${esc(o.dest.label)}</div></span>${o.estimate ? `<b>${o.estimate.low}–${o.estimate.high} lei</b>` : ''}</div>` : ''}
        </div>
        <button class="linkbtn danger mt" id="cancelOrder">Anulează comanda</button>
      </div>`;
  },

  assigned(o) {
    const car = myCar(o);
    return `
      ${peek(`Taxi ${car ? car.cs : ''} ajunge în <span data-eta>–</span> min`, carPlate(car), car ? `${esc(car.model)} ${esc(car.color)} · ${esc(car.driver)}` : '')}
      <div class="main">
        <div class="hstack between">
          <div><div class="muted small" style="font-weight:700">Taxiul ajunge în</div><div class="eta-big"><span class="n" data-eta>–</span><span class="u">min</span></div></div>
          <div class="vstack" style="align-items:flex-end;gap:6px">${carPlate(car)}<span class="cs-badge"><small>IND.</small>${car ? car.cs : ''}</span></div>
        </div>
        ${carCard(car, o)}
        ${actions(o)}
        ${o.payment === 'card' ? `<p class="small muted center" style="margin:12px 0 0">Plată cu cardul •••• ${esc(o.card ? o.card.last4 : '')}, automat la final</p>` : `<p class="small muted center" style="margin:12px 0 0">Plată cash la șofer${o.estimate ? ` · estimat ${o.estimate.low}–${o.estimate.high} lei` : ''}</p>`}
        <button class="linkbtn danger" id="cancelOrder">Anulează comanda</button>
      </div>`;
  },

  arrived(o) {
    const car = myCar(o);
    return `
      ${peek('Taxiul te așteaptă!', carPlate(car), car ? `Taxi ${car.cs} · ${esc(car.model)} ${esc(car.color)}` : '')}
      <div class="main">
        <div class="arrived-banner">${icon('pin', { size: 34 })}<div><div class="t">Taxiul te așteaptă!</div><div>Caută mașina ${esc(car ? car.color : '')} cu indicativul <b>${car ? car.cs : ''}</b>:</div></div></div>
        <div class="hstack" style="justify-content:center;margin:6px 0 12px;gap:12px">${carPlate(car, true)}<span class="cs-badge" style="height:52px;min-width:56px;font-size:1.6em">${car ? car.cs : ''}</span></div>
        ${carCard(car, o)}
        <p class="center free-wait" data-wait></p>
        <button class="btn dark block xl" data-quickmsg="Ies acum, ajung în 1-2 minute">${icon('message')}Spune-i „Ies acum”</button>
        <div class="mt">${actions(o)}</div>
      </div>`;
  },

  inride(o) {
    const dest = o.dest || o.destInCar;
    const sos = o.sos && o.sos.active;
    return `
      ${peek(`Spre ${esc(dest ? dest.label : 'destinație')}`, `<button class="sos-pill ${sos ? 'on' : ''}" id="sosBtn">${icon('shield', { size: 18 })}SOS</button>`, `Ajungi la <b data-arrive-at>–</b>`)}
      <div class="main">
        ${sos ? `<div class="sos-on">${icon('shield', { size: 26 })}<div><b>Dispeceratul a fost alertat</b><div class="small">Ascultă în timp real ce se întâmplă în mașină. Rămâi calm.</div></div></div>` : ''}
        <div class="grid2">
          <div class="stat"><div class="k">Ajungi la</div><div class="v" data-arrive-at>–</div></div>
          <div class="stat"><div class="k">${o.estimate ? 'Preț estimat' : 'Tarif'}</div><div class="v">${o.estimate ? `${o.estimate.low}–${o.estimate.high} lei` : `${fmtMoney(perKm())} lei/km`}</div></div>
        </div>
        ${carCard(myCar(o), o)}
        <div class="actions3">
          <button class="act" id="shareRide">${icon('share')}Distribuie cursa</button>
          <button class="act" data-chat>${icon('message')}Mesaj<span class="badge" data-unread hidden></span></button>
          <button class="act" data-call>${icon('phone')}Sună</button>
        </div>
      </div>`;
  },

  done(o) {
    const car = myCar(o) || {};
    const paidCard = o.payment === 'card';
    const d = ui.done[o.id] || (ui.done[o.id] = { stars: 0, tags: [], text: '', tipPct: 0, tipCustom: null, tipMethod: paidCard ? 'card' : (profile.card ? 'card' : 'cash') });
    const tip = tipAmount(o, d);
    const canCardTip = !!profile.card;
    const dest = o.dest || o.destInCar;
    const routeSaved = dest && (profile.routes || []).some(r => sameRoute(r, o.pickup, dest));
    if (o.tip && o.review) return `${peek('Mulțumim!', '', '')}<div class="main center"><p>Ai trimis evaluarea${o.tip ? ` și ${fmtMoney(o.tip.amount)} lei bacșiș` : ''}.</p><button class="btn primary block xl" id="doneBtn">Gata</button></div>`;
    return `
      ${peek(`Total cursă: ${fmtMoney(o.fare)} lei`, '', paidCard ? 'Plătit automat cu cardul' : 'Plătește șoferului cash')}
      <div class="main">
        <div class="receipt">
          <div class="muted" style="font-weight:700">Ai ajuns! Total cursă</div>
          <div class="total">${fmtMoney(o.fare)} lei</div>
          ${paidCard ? `<div class="paid-ok">${icon('check', { size: 20, stroke: 2.6 })}Plătit automat · ${esc(o.card ? o.card.brand : 'Card')} •••• ${esc(o.card ? o.card.last4 : '')}</div>`
            : `<div class="paid-cash">${icon('cash', { size: 20 })}Plătește șoferului cash</div>`}
          <div class="small muted mt">${o.rideMeters ? fmtKm(o.rideMeters) + ' · ' : ''}Taxi ${car.cs || ''} · ${esc(car.driver || '')}</div>
        </div>
        <div class="divider"></div>
        <h3 style="margin:0 0 8px">Lasă un bacșiș lui ${esc(firstName(car.driver))}</h3>
        <div class="tips">
          ${[0, 5, 10, 15, 20].map(p => `<button class="tipb ${d.tipCustom == null && d.tipPct === p ? 'on' : ''}" data-tip="${p}">${p ? `${p}%<small>${fmtMoney(Math.round(o.fare * p) / 100)} lei</small>` : 'Fără'}</button>`).join('')}
          <button class="tipb ${d.tipCustom != null ? 'on' : ''}" id="tipCustom">${d.tipCustom != null ? `${fmtMoney(d.tipCustom)}<small>lei</small>` : 'Altă<small>sumă</small>'}</button>
        </div>
        ${tip > 0 && !paidCard ? `<div class="seg mt">
            <button data-tm="cash" class="${d.tipMethod === 'cash' ? 'on' : ''}">${icon('cash')}Cash</button>
            <button data-tm="card" class="${d.tipMethod === 'card' ? 'on' : ''}">${icon('card')}${canCardTip ? `Card •••• ${esc(profile.card.last4)}` : 'Adaugă card'}</button>
          </div>` : ''}
        ${tip > 0 ? `<p class="small muted" style="margin:8px 2px 0">${d.tipMethod === 'card' || paidCard ? `${fmtMoney(tip)} lei se iau de pe card, 100% merg la șofer.` : `Îi dai șoferului ${fmtMoney(tip)} lei cash.`}</p>` : ''}
        <div class="divider"></div>
        <h3 class="center" style="margin:0">Cum a fost cursa?</h3>
        <div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= d.stars ? 'on' : ''}" aria-label="${i} stele">${icon('star', { size: 40, stroke: 1.6 })}</button>`).join('')}</div>
        <div class="chips wrap" style="justify-content:center" ${d.stars ? '' : 'hidden'} id="tags">
          ${(d.stars >= 4 || !d.stars ? ['Șofer amabil', 'Mașină curată', 'Condus atent', 'Punctual'] : ['A întârziat', 'Condus agresiv', 'Mașină murdară', 'Traseu ocolit']).map(t => `<button class="chip ${d.tags.includes(t) ? 'on' : ''}" data-tag="${t}">${t}</button>`).join('')}
        </div>
        <label class="field mt" ${d.stars ? '' : 'hidden'} id="revWrap"><span>Recenzie (opțional)</span><textarea class="input" id="revText" placeholder="Spune-ne cum a fost">${esc(d.text)}</textarea></label>
        ${dest && !routeSaved ? `<button class="save-route" id="saveRouteDone">${icon('star', { size: 18 })}Salvează ruta ${esc(o.pickup.label)} → ${esc(dest.label)}</button>` : ''}
        <button class="btn primary block xl mt" id="sendDone">${tip > 0 || d.stars ? 'Trimite' : 'Gata'}${tip > 0 ? ` · bacșiș ${fmtMoney(tip)} lei` : ''}</button>
        <button class="linkbtn" id="lostBtn">Am uitat ceva în mașină</button>
      </div>`;
  },

  cancelled(o) {
    return `
      ${peek('Comanda a fost anulată')}
      <div class="main center" style="padding:8px 0">
        <div class="bubble" style="margin:0 auto 10px;width:64px;height:64px;border-radius:20px;background:var(--danger-soft);color:var(--danger)">${icon('alert', { size: 30 })}</div>
        <p class="muted" style="margin:0">${esc(o.cancelReason || 'Ne pare rău pentru neplăcere.')}</p>
        <button class="btn primary block xl mt" id="reorder">Comandă din nou</button>
        <button class="btn ghost block mt" id="closeCancelled">Închide</button>
      </div>`;
  },

  pickmap() {
    return `
      ${peek(ui.pickMode === 'dest' ? 'Alege destinația' : 'De unde te luăm?', '', 'Mută harta până când pinul e exact pe loc.')}
      <div class="main">
        <div class="where"><span class="dot ${ui.pickMode === 'dest' ? 'dest' : ''}"></span><span class="grow"><div class="val" id="pickAddr">…</div></span></div>
        <button class="btn primary block xl mt" id="pickOk">Confirmă locul</button>
        <button class="btn ghost block mt" data-back>Renunță</button>
      </div>`;
  },
};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function paySeg(big) {
  const card = profile.card;
  return `<div class="seg ${big ? 'big' : ''}">
    <button data-pay="cash" class="${ui.payment === 'cash' ? 'on' : ''}">${icon('cash')}Cash</button>
    <button data-pay="card" class="${ui.payment === 'card' ? 'on' : ''}">${icon('card')}${card ? `Card <span class="sub">•••• ${card.last4}</span>` : 'Card'}</button>
  </div>${ui.payment === 'card' ? `<p class="small muted" style="margin:8px 2px 0">Suma de pe taximetru se ia automat de pe card la finalul cursei.</p>` : ''}`;
}
function carPlate(car, big = false) {
  if (!car) return '';
  return `<span class="plate" style="${big ? 'font-size:1.5em' : ''}"><span class="eu">RO</span><span class="num">${esc(car.plate)}</span></span>`;
}
function carCard(car, o) {
  if (!car) return '';
  const req = o ? reqOptions(o.options) : [];
  const r = car.reviews && car.reviews[0];
  return `<button class="car-card" data-driver="${car.id}">${avatar(car.driver, car.photo, 54)}<div class="grow" style="text-align:left">
    <div class="who">${esc(car.driver)} <span class="rating">${icon('star', { size: 16 })}${car.rating.toLocaleString('ro-RO')}</span></div>
    <div class="what">${esc(car.model)} ${esc(car.color)} · ${car.years} ani experiență</div>
    ${req.length ? `<div class="capicons" style="margin-top:6px">${req.map(k => `<span class="pill ${carHas(car, k) ? 'st-liber' : ''}">${carHas(car, k) ? '✓' : '✕'} ${optionLabel(k)}</span>`).join('')}</div>` : ''}
    ${r ? `<div class="small muted" style="margin-top:4px">„${esc(r.text)}” · <span class="stars-s">${'★'.repeat(r.stars)}</span></div>` : ''}
  </div>${icon('chevron', { size: 18, cls: 'muted' })}</button>`;
}
function actions(o) {
  return `<div class="actions3">
    <button class="act" data-call>${icon('phone')}Sună</button>
    <button class="act" data-chat>${icon('message')}Mesaj<span class="badge" data-unread hidden></span></button>
    <button class="act" id="shareRide">${icon('share')}Distribuie cursa</button>
  </div>`;
}
const sameRoute = (r, a, b) => r.from && r.to && dist([r.from.lat, r.from.lon], [a.lat, a.lon]) < 60 && dist([r.to.lat, r.to.lon], [b.lat, b.lon]) < 60;
function tipAmount(o, d) { return d.tipCustom != null ? d.tipCustom : Math.round(o.fare * d.tipPct) / 100; }

// ---------- evenimente ----------
function bindCommon() {
  $$('[data-pick]', body).forEach(b => b.onclick = () => openSearch(b.dataset.pick));
  $$('[data-back]', body).forEach(b => b.onclick = () => { ui.screen = 'home'; ui.requestCar = null; ui.scheduledFor = null; ui.quickRoute = null; ui.lastKey = ''; render(); });
  $$('[data-collapse]', body).forEach(b => b.onclick = () => setCollapsed(!ui.collapsed));
  $$('[data-call]', body).forEach(b => b.onclick = callDriver);
  $$('[data-chat]', body).forEach(b => b.onclick = () => openChat());
  $$('[data-driver]', body).forEach(b => b.onclick = () => openCarCard(b.dataset.driver, true));
  $$('[data-quickmsg]', body).forEach(b => b.onclick = () => { const o = currentOrder(); if (o) { bus.act('message', { orderId: o.id, from: 'client', text: b.dataset.quickmsg }); toast('Mesaj trimis șoferului', 'ok', 2000, 'check'); } });
  $$('[data-pay]', body).forEach(b => b.onclick = () => {
    if (b.dataset.pay === 'card' && !profile.card) { openCardForm(() => { ui.payment = 'card'; render(); }); return; }
    ui.payment = b.dataset.pay; render();
  });
  const share = $('#shareRide', body); if (share) share.onclick = () => openShare();
  const cancel = $('#cancelOrder', body); if (cancel) cancel.onclick = cancelOrder;
  const sw = $('.swipe', body); if (sw) bindSwipe(sw, placeOrder, ui.scheduledFor ? 'Se programează…' : 'Se trimite comanda…');
}

const BIND = {
  home() {
    $('#orderHere').onclick = () => goConfirm(null);
    $$('[data-quick]').forEach(b => b.onclick = () => { const s = profile.saved[b.dataset.quick]; goConfirm({ lat: s.lat, lon: s.lon, label: s.address }); });
    $('#routesBtn').onclick = openRoutes;
    const sb = $('#schedBtn'); if (sb) sb.onclick = openScheduledList;
    $('#planBtn').onclick = () => { goConfirm(null); setTimeout(openSchedule, 50); };
  },
  confirm() {
    $$('[data-opt]').forEach(b => b.onclick = () => { ui.options[b.dataset.opt] = !ui.options[b.dataset.opt]; render(); });
    $('#moreBtn').onclick = () => { ui.optsOpen = !ui.optsOpen; render(); };
    const note = $('#note'); if (note) note.oninput = () => { ui.note = note.value; };
    $('#whenBtn').onclick = openSchedule;
    const wc = $('#whenClear'); if (wc) wc.onclick = () => { ui.scheduledFor = null; render(); };
    const rcx = $('#reqClear'); if (rcx) rcx.onclick = () => { ui.requestCar = null; ui.scheduledFor = null; render(); };
    const sr = $('#saveRoute'); if (sr) sr.onclick = () => { if (!sr.classList.contains('on')) saveRouteDialog(ui.pickup, ui.dest); };
  },
  quick() {
    $('#quickEdit').onclick = () => { const r = ui.quickRoute; ui.pickup = r.from; ui.quickRoute = null; goConfirm(r.to); };
  },
  done(o) {
    const d = ui.done[o.id];
    const doneBtn = $('#doneBtn'); if (doneBtn) { doneBtn.onclick = () => finishDone(o); return; }
    $$('[data-tip]').forEach(b => b.onclick = () => { d.tipPct = +b.dataset.tip; d.tipCustom = null; rerenderDone(); });
    $('#tipCustom').onclick = () => {
      const ov = modal(`<div class="panel-head"><h2>Altă sumă</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
        <label class="field"><span>Bacșiș (lei)</span><input class="input" id="tipIn" inputmode="decimal" placeholder="ex. 5" autofocus></label>
        <button class="btn primary block xl" id="tipOk">Confirmă</button>`);
      $('#tipOk', ov).onclick = () => { const v = parseFloat(($('#tipIn', ov).value || '').replace(',', '.')); if (!(v > 0) || v > 500) { toast('Scrie o sumă între 1 și 500 lei.', 'warn'); return; } d.tipCustom = Math.round(v * 100) / 100; ov.close(); rerenderDone(); };
    };
    $$('[data-tm]').forEach(b => b.onclick = () => {
      if (b.dataset.tm === 'card' && !profile.card) { openCardForm(() => { d.tipMethod = 'card'; rerenderDone(); }); return; }
      d.tipMethod = b.dataset.tm; rerenderDone();
    });
    $$('[data-star]').forEach(b => b.onclick = () => { d.stars = +b.dataset.star; d.tags = []; rerenderDone(); });
    $$('[data-tag]').forEach(b => b.onclick = () => { const t = b.dataset.tag; d.tags = d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t]; b.classList.toggle('on'); });
    const rt = $('#revText'); if (rt) rt.oninput = () => { d.text = rt.value; };
    const srd = $('#saveRouteDone'); if (srd) srd.onclick = () => saveRouteDialog(o.pickup, o.dest || o.destInCar);
    $('#sendDone').onclick = () => {
      const tip = tipAmount(o, d);
      if (tip > 0) bus.act('tip', { orderId: o.id, amount: tip, method: o.payment === 'card' ? 'card' : d.tipMethod });
      if (d.stars) bus.act('rateOrder', { orderId: o.id, stars: d.stars, tags: d.tags, text: d.text.trim() });
      if (tip > 0 || d.stars) toast(`Mulțumim!${tip > 0 ? ` ${firstName(myCar(o)?.driver || '')} a primit ${fmtMoney(tip)} lei bacșiș.` : ''}`, 'ok', 3500, 'check');
      finishDone(o, d.stars);
    };
    $('#lostBtn').onclick = lostItem;
  },
  cancelled(o) {
    $('#reorder').onclick = () => { ui.pickup = o.pickup; store.set('client-order', null); goConfirm(o.dest); };
    $('#closeCancelled').onclick = () => { store.set('client-order', null); ui.screen = 'home'; ui.lastKey = ''; render(); };
  },
  pickmap() {
    $('#pickOk').onclick = () => {
      const c = map.getCenterForPin();
      const place = { lat: c.lat, lon: c.lng, label: cityMap.reverse([c.lat, c.lng]), kind: 'map' };
      endPickMap();
      ui.screen = ui.prevScreen || 'home';
      setPlace(ui.pickMode, place);
    };
    $$('[data-back]').forEach(b => b.onclick = () => { endPickMap(); ui.screen = ui.prevScreen || 'home'; ui.lastKey = ''; render(); });
  },
};
function rerenderDone() { const sc = sheet.scrollTop; ui.lastKey = ''; render(); sheet.scrollTop = sc; }
function finishDone(o, stars) {
  saveHistory(o, stars);
  store.set('client-order', null);
  ui.dest = null; ui.screen = 'home'; ui.lastKey = ''; ui.chatSeen = 0;
  render();
}

// ---------- fluxuri ----------
function goConfirm(dest) {
  if (dest) ui.dest = dest;
  ui.estimate = ui.dest ? (() => { const r = cityMap.route([ui.pickup.lat, ui.pickup.lon], [ui.dest.lat, ui.dest.lon]); return estimateFare(r.meters, new Date(ui.scheduledFor || Date.now()), r.slow); })() : null;
  ui.screen = 'confirm'; ui.lastKey = ''; render();
}

function setPlace(mode, place) {
  if (mode === 'pickup') { ui.pickup = place; store.set('client-last-pickup', place); }
  else if (mode === 'dest') ui.dest = place;
  else if (mode === 'save-home' || mode === 'save-work') {
    const k = mode === 'save-home' ? 'home' : 'work';
    profile.saved = profile.saved || {};
    profile.saved[k] = { label: k === 'home' ? 'Acasă' : 'Serviciu', address: place.label, lat: place.lat, lon: place.lon };
    saveProfile(); toast('Adresă salvată', 'ok', 2000, 'check'); ui.lastKey = ''; render(); return;
  } else if (mode === 'route-from' || mode === 'route-to') {
    ui.newRoute = ui.newRoute || {};
    ui.newRoute[mode === 'route-from' ? 'from' : 'to'] = place;
    if (!ui.newRoute.to) { setTimeout(() => openSearch('route-to'), 50); return; }
    saveRouteDialog(ui.newRoute.from, ui.newRoute.to); ui.newRoute = null; return;
  }
  if (ui.screen === 'confirm' || mode === 'dest') goConfirm(null);
  else { ui.lastKey = ''; render(); }
}

function placeOrder() {
  if (ui.payment === 'card' && !profile.card) { openCardForm(placeOrder); return; }
  const id = uid('o');
  const qr = ui.screen === 'quick' ? ui.quickRoute : null;
  const pickup = qr ? qr.from : ui.pickup, dest = qr ? qr.to : ui.dest;
  const rc = ui.requestCar ? carById(ui.requestCar) : null;
  const payload = {
    id, source: 'app',
    client: { name: profile.name, phone: profile.phone, photo: profile.photo || null },
    pickup: { lat: pickup.lat, lon: pickup.lon, label: pickup.label },
    dest: dest ? { lat: dest.lat, lon: dest.lon, label: dest.label } : null,
    note: qr ? '' : ui.note.trim(), options: qr ? {} : { ...ui.options }, payment: ui.payment,
    card: ui.payment === 'card' ? { brand: profile.card.brand, last4: profile.card.last4 } : null,
    estimate: ui.estimate, scheduledFor: ui.scheduledFor, requestCar: ui.requestCar,
  };
  const scheduled = !!payload.scheduledFor;
  if (scheduled) store.set('client-scheduled', [...scheduledIds(), id]);
  else { store.set('client-order', id); ui.chatSeen = 0; ui.lastStatus = 'cautare'; ui.requestedName = rc ? firstName(rc.driver) : null; }
  bus.act('createOrder', payload);
  ui.note = ''; ui.options = {}; ui.optsOpen = false; ui.scheduledFor = null; ui.requestCar = null; ui.quickRoute = null; ui.screen = 'home'; ui.dest = null;
  if (scheduled) {
    toast(rc ? `Cererea a fost trimisă lui ${esc(firstName(rc.driver))}. Te anunțăm când răspunde.` : `Cursa e programată pentru ${dayLabel(payload.scheduledFor)} la ${fmtTime(payload.scheduledFor)}.`, 'ok', 4500, 'calendar');
    ui.lastKey = ''; render();
  }
}

async function cancelOrder() {
  const o = currentOrder(); if (!o) return;
  const ok = await confirmBox('Anulezi comanda?', o.carId ? 'Șoferul este deja pe drum spre tine.' : 'Încă nu a fost alocat niciun taxi.', { yes: 'Da, anulează', no: 'Nu, păstrează', danger: true });
  if (!ok) return;
  bus.act('cancelOrder', { orderId: o.id, by: 'client' });
  store.set('client-order', null);
  ui.screen = 'home'; ui.lastKey = '';
  render();
  toast('Comanda a fost anulată.', '', 2500);
}

function saveHistory(o, stars) {
  const car = myCar(o) || {};
  profile.history = profile.history || [];
  if (profile.history.some(x => x.id === o.id)) return;
  profile.history.unshift({ id: o.id, t: o.finishedAt, pickup: o.pickup, dest: o.dest || o.destInCar, fare: o.fare, tip: o.tip ? o.tip.amount : 0, payment: o.payment, card: o.card, plate: car.plate, cs: car.cs, driver: car.driver, stars });
  profile.history = profile.history.slice(0, 30);
  saveProfile();
}
function saveProfile() { store.set('client-profile', profile); }

// ---------- rute salvate ----------
function openRoutes() {
  const routes = profile.routes || [];
  const ov = modal(`
    <div class="panel-head"><h2>Rute salvate</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin:-6px 0 8px">Alege ruta, apoi plata, și glisezi. Gata.</p>
    ${routes.length ? routes.map((r, i) => {
      const est = estimateFare(cityMap.route([r.from.lat, r.from.lon], [r.to.lat, r.to.lon]).meters);
      return `<div class="route-row"><button class="row" data-r="${i}" style="border:0"><span class="bubble accent">${icon('route', { size: 22 })}</span><span class="grow"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.from.label)} → ${esc(r.to.label)}</div></span><b class="small" style="white-space:nowrap">${est.low}–${est.high} lei</b></button><button class="icon-btn flat sm-btn" data-del="${i}" aria-label="Șterge ruta ${esc(r.name)}">${icon('close', { size: 18 })}</button></div>`;
    }).join('') : '<p class="muted center" style="padding:20px 0">Nu ai încă rute salvate.</p>'}
    <button class="btn ghost block mt" id="addRoute">${icon('plus')}Adaugă o rută</button>
  `);
  $$('[data-r]', ov).forEach(b => b.onclick = () => {
    const r = routes[+b.dataset.r];
    ov.close();
    ui.quickRoute = r;
    const rr = cityMap.route([r.from.lat, r.from.lon], [r.to.lat, r.to.lon]);
    ui.estimate = estimateFare(rr.meters, new Date(), rr.slow);
    ui.screen = 'quick'; ui.lastKey = ''; render();
  });
  $$('[data-del]', ov).forEach(b => b.onclick = async () => {
    const r = routes[+b.dataset.del];
    ov.close();
    if (await confirmBox('Ștergi ruta?', `„${esc(r.name)}” nu va mai apărea în lista ta.`, { yes: 'Șterge', danger: true })) { profile.routes.splice(+b.dataset.del, 1); saveProfile(); ui.lastKey = ''; render(); }
    openRoutes();
  });
  $('#addRoute', ov).onclick = () => { ov.close(); ui.newRoute = {}; openSearch('route-from'); };
}
function saveRouteDialog(from, to) {
  const sugg = ['La serviciu', 'Acasă', 'La școală', 'La mama', 'Cumpărături', 'Spital'];
  const ov = modal(`
    <div class="panel-head"><h2>Salvează ruta</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin:-6px 0 12px">${esc(from.label)} → ${esc(to.label)}</p>
    <label class="field"><span>Nume</span><input class="input" id="rn" placeholder="ex. La serviciu" autofocus></label>
    <div class="chips wrap mb">${sugg.map(s => `<button class="chip" data-s="${s}">${s}</button>`).join('')}</div>
    <button class="btn primary block xl" id="rsave">Salvează</button>`);
  $$('[data-s]', ov).forEach(b => b.onclick = () => { $('#rn', ov).value = b.dataset.s; });
  $('#rsave', ov).onclick = () => {
    const name = $('#rn', ov).value.trim() || `${to.label}`;
    profile.routes = [...(profile.routes || []), { name, from: { label: from.label, lat: from.lat, lon: from.lon }, to: { label: to.label, lat: to.lat, lon: to.lon } }];
    saveProfile(); ov.close(); toast(`Ruta „${esc(name)}” a fost salvată`, 'ok', 2500, 'star'); ui.lastKey = ''; render();
  };
}

// ---------- detalii mașină (atingi o mașină pe hartă) ----------
function openCarCard(id, fromOrder = false) {
  const car = carById(id); if (!car) return;
  const cat = colorCat(car);
  const o = currentOrder();
  const mine = o && o.carId === id;
  const left = pauseLeft(car);
  const busyEta = car.move && (car.status === STATUS.cu || car.status === STATUS.spre) ? etaSeconds(car) : null;
  const canOrder = !o && !mine;
  let status = '', actionsHtml = '';
  if (cat === 'liber') {
    status = `Liber${car.station ? ' · așteaptă în stație' : ''} · la ~${fmtMin(etaToMe(car))} de tine`;
    if (canOrder) actionsHtml = `<button class="btn go block xl" id="ccOrder">${icon('car')}Cere cursă cu ${esc(firstName(car.driver))}</button>`;
  } else if (cat === 'pauza') {
    status = left != null ? (left > 0 ? `În pauză · revine în ~${fmtMin(left)}` : 'Își termină pauza acum') : 'În pauză';
    if (canOrder) {
      const at = car.pauseUntil && car.pauseUntil > Date.now() ? car.pauseUntil : null;
      actionsHtml = at
        ? `<button class="btn dark block xl" id="ccSched" data-at="${at}">${icon('calendar')}Programează cu ${esc(firstName(car.driver))} la ${fmtTime(at)}</button>`
        : `<div class="small muted mb">Alege peste cât timp:</div><div class="grid3">${[10, 15, 30].map(m => `<button class="btn" data-in="${m}">${m} min</button>`).join('')}</div>`;
      actionsHtml += `<p class="small muted" style="margin:8px 2px 0">Șoferul primește cererea pe telefon și o acceptă sau îți scrie în chat.</p>`;
    }
  } else if (cat === 'spre_client') status = `Merge la o comandă${busyEta ? ` · ajunge în ~${fmtMin(busyEta)}` : ''}`;
  else if (cat === 'cu_client') status = `Are client · liber în ~${fmtMin(busyEta || 300)}`;
  const caps = carCapsList(car);
  const ov = modal(`
    <div class="cc-head">
      <span class="cc-car ${cat}">${carSvg(cat, 54)}</span>
      <div class="grow"><div class="small muted" style="font-weight:700">Indicativ</div><div class="cc-cs">${car.cs}</div></div>
      <button class="icon-btn flat" data-close aria-label="Închide">${icon('close')}</button>
    </div>
    <div class="pill st-${cat === 'liber' ? 'liber' : cat}" style="font-size:.9em;padding:7px 12px;margin-bottom:12px"><span class="dot"></span>${esc(status)}</div>
    <div class="hstack" style="gap:14px">${avatar(car.driver, car.photo, 60)}<div class="grow"><div style="font-weight:800;font-size:1.1em">${esc(car.driver)}</div><div class="rating">${icon('star', { size: 16 })}${car.rating.toLocaleString('ro-RO')} <span class="muted" style="font-weight:600">· ${car.years} ani experiență</span></div></div></div>
    <div class="grid2 mt">
      <div class="stat"><div class="k">Mașina</div><div class="v" style="font-size:1.05em">${esc(car.model)} ${esc(car.color)}</div></div>
      <div class="stat"><div class="k">Număr</div><div class="v" style="font-size:1.05em">${esc(car.plate)}</div></div>
    </div>
    ${caps.length ? `<div class="capicons mt">${caps.map(c => `<span class="pill">${icon(c.icon, { size: 16 })}${c.short}</span>`).join('')}</div>` : ''}
    ${car.reviews && car.reviews.length ? `<h3 style="margin:16px 0 4px">Recenzii recente</h3>${car.reviews.slice(0, 3).map(r => `<div class="review"><span class="stars-s">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span> ${esc(r.text)}<div class="who">${esc(r.by)} · ${relDay(r.t)}</div></div>`).join('')}` : ''}
    ${actionsHtml ? `<div class="mt">${actionsHtml}</div>` : ''}
  `);
  const ord = $('#ccOrder', ov);
  if (ord) ord.onclick = () => { ov.close(); ui.requestCar = car.id; ui.scheduledFor = null; goConfirm(null); };
  const sch = $('#ccSched', ov);
  if (sch) sch.onclick = () => { ov.close(); ui.requestCar = car.id; ui.scheduledFor = +sch.dataset.at; goConfirm(null); };
  $$('[data-in]', ov).forEach(b => b.onclick = () => { ov.close(); ui.requestCar = car.id; ui.scheduledFor = Date.now() + +b.dataset.in * 60e3; goConfirm(null); });
}
const relDay = t => { const d = Math.round((Date.now() - t) / 86400e3); return d <= 0 ? 'azi' : d === 1 ? 'ieri' : `acum ${d} zile`; };

// ---------- popup când șoferul acceptă ----------
function showAcceptedPopup(o) {
  const car = myCar(o); if (!car) return;
  const ov = modal(`
    <div class="center">
      <div class="small" style="font-weight:800;color:var(--free);letter-spacing:.06em;text-transform:uppercase">Taxi găsit</div>
      <div class="acc-top">${avatar(car.driver, car.photo, 76)}<span class="cs-badge" style="height:60px;min-width:70px;font-size:2em"><small>IND.</small>${car.cs}</span></div>
      <h2 style="margin:6px 0 2px">${esc(car.driver)}</h2>
      <div class="rating" style="justify-content:center">${icon('star', { size: 16 })}${car.rating.toLocaleString('ro-RO')} <span class="muted" style="font-weight:600">· ${car.years} ani experiență</span></div>
      <div class="hstack" style="justify-content:center;margin:12px 0 4px;gap:10px">${carPlate(car, true)}</div>
      <div class="muted">${esc(car.model)} ${esc(car.color)} · ajunge în <b data-eta>${Math.max(1, Math.round(etaSeconds(car) / 60))}</b> min</div>
    </div>
    ${car.reviews && car.reviews.length ? `<div class="acc-rev">${car.reviews.slice(0, 2).map(r => `<div class="review"><span class="stars-s">${'★'.repeat(r.stars)}</span> ${esc(r.text)}<div class="who">${esc(r.by)} · ${relDay(r.t)}</div></div>`).join('')}</div>` : ''}
    <div class="vstack mt">
      <button class="btn primary block xl" id="accTrack">${icon('nav')}Urmărește comanda</button>
      <button class="btn dark block xl" id="accShare">${icon('share')}Distribuie cursa</button>
    </div>
    <p class="small muted center" style="margin:10px 0 0">Nu ți se pare în regulă? Poți anula comanda din ecranul următor.</p>
  `, { cls: 'acc-ov' });
  $('#accTrack', ov).onclick = () => { ov.close(); setCollapsed(false); };
  $('#accShare', ov).onclick = () => { ov.close(); openShare(); };
}

// ---------- distribuie cursa ----------
function shareText(o, car) {
  const dest = o.dest || o.destInCar;
  return `Urmărește cursa mea cu ${CONFIG.company.name}: taxi ${car.cs} (${car.plate}, ${car.model} ${car.color}), șofer ${car.driver}. Comandată la ${fmtTime(o.createdAt)} de la ${o.pickup.label}${dest ? ` spre ${dest.label}` : ''}. Vezi live: ${CONFIG.shareBase}${o.code}`;
}
function openShare() {
  const o = currentOrder(); const car = myCar(o); if (!o || !car) return;
  const text = shareText(o, car);
  const ov = modal(`
    <div class="panel-head"><h2>Distribuie cursa</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin:-6px 0 12px">Persoana care primește linkul vede live mașina, șoferul și traseul, până ajungi.</p>
    <div class="share-card">
      <div class="hstack"><span class="cs-badge">${car.cs}</span><div class="grow"><b>${esc(car.plate)}</b><div class="small muted">${esc(car.model)} ${esc(car.color)} · ${esc(car.driver)}</div></div></div>
      <div class="small" style="margin-top:10px">Comandată la <b>${fmtTime(o.createdAt)}</b> · ${esc(o.pickup.label)}${(o.dest || o.destInCar) ? ` → ${esc((o.dest || o.destInCar).label)}` : ''}</div>
      <div class="share-link">${esc(CONFIG.shareBase + o.code)}</div>
    </div>
    <div class="vstack mt">
      <button class="btn primary block xl" id="shSend">${icon('share')}Trimite unui apropiat</button>
      <button class="btn block" id="shCopy">${icon('check')}Copiază mesajul</button>
      <button class="btn ghost block" id="shView">${icon('user')}Vezi ce vede apropiatul</button>
    </div>
  `);
  $('#shSend', ov).onclick = async () => {
    try { if (navigator.share) { await navigator.share({ title: CONFIG.company.name, text }); return; } } catch { return; }
    copyText(text);
  };
  $('#shCopy', ov).onclick = () => copyText(text);
  $('#shView', ov).onclick = () => { ov.close(); openFollower(o.id); };
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Mesajul a fost copiat. Lipește-l în WhatsApp sau SMS.', 'ok', 3500, 'check'); }
  catch { modal(`<h2>Copiază mesajul</h2><textarea class="input" style="min-height:140px" readonly>${esc(text)}</textarea><button class="btn block mt" data-close>Închide</button>`); }
}

// Ecranul pe care îl vede apropiatul (în producție e o pagină web publică, fără cont)
function openFollower(orderId) {
  const el = h(`<div class="follow">
    <div class="follow-bar"><button class="icon-btn flat" data-x aria-label="Închide">${icon('back')}</button><div class="grow"><b>Urmărire cursă</b><div class="small muted">Așa vede persoana căreia i-ai trimis linkul</div></div></div>
    <div class="follow-map" id="fMap"></div>
    <div class="follow-info" id="fInfo"></div>
  </div>`);
  document.body.append(el);
  const fm = createMap($('#fMap', el), { cityMap, zoom: 14 });
  const planned = L.polyline([], { color: '#7C818B', weight: 4, dashArray: '2 9', lineCap: 'round' }).addTo(fm);
  const done = new RouteLine(fm, cssVar('--busy'));
  const ff = new FleetLayer(fm, { filter: c => { const o = bus.state.orders.find(x => x.id === orderId); return o && c.id === o.carId; }, stations: false, tag: c => String(c.cs) });
  let fitted = false, pm, dm;
  const draw = state => {
    const o = state.orders.find(x => x.id === orderId); if (!o) return;
    const car = state.cars.find(c => c.id === o.carId);
    ff.update(state);
    planned.setLatLngs(o.plannedRoute || []);
    done.set(o.track.slice(o.rideStartIdx ?? 0), cssVar('--busy'));
    if (!pm) pm = L.marker([o.pickup.lat, o.pickup.lon], { icon: pinIcon('pickup', 'person') }).addTo(fm);
    const d = o.dest || o.destInCar;
    if (d && !dm) dm = L.marker([d.lat, d.lon], { icon: pinIcon('dest', 'flag') }).addTo(fm);
    if (!fitted) { fitted = true; const pts = [[o.pickup.lat, o.pickup.lon], ...(o.plannedRoute || [])]; if (car) pts.push(carPos(car).p); fm.fitBounds(L.latLngBounds(pts).pad(0.2)); }
    const stLine = { acceptata: `Taxiul e pe drum spre ${firstName(o.client.name)}`, sosit: `Taxiul a ajuns la ${firstName(o.client.name)}`, in_cursa: `${firstName(o.client.name)} e în taxi`, finalizata: `Cursa s-a încheiat la ${fmtTime(o.finishedAt)}` }[o.status] || ORDER_TXT(o);
    $('#fInfo', el).innerHTML = `
      <div class="follow-st">${o.status === 'finalizata' ? icon('check', { size: 20 }) : '<span class="live"></span>'}${esc(stLine)}</div>
      ${car ? `<div class="hstack mt"><span class="cs-badge">${car.cs}</span><div class="grow"><b>${esc(car.plate)}</b> · ${esc(car.model)} ${esc(car.color)}<div class="small muted">Șofer: ${esc(car.driver)} · ★ ${car.rating.toLocaleString('ro-RO')}</div></div></div>` : ''}
      <div class="grid2 mt">
        <div class="stat"><div class="k">Comandată la</div><div class="v" style="font-size:1.05em">${fmtTime(o.createdAt)}</div></div>
        <div class="stat"><div class="k">${o.status === 'finalizata' ? 'Ajuns la' : 'Sosire estimată'}</div><div class="v" style="font-size:1.05em">${o.status === 'finalizata' ? fmtTime(o.finishedAt) : car && o.status === 'in_cursa' ? fmtTime(Date.now() + etaSeconds(car) * 1000) : '—'}</div></div>
      </div>
      <div class="small mt">${icon('person', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc(o.pickup.label)}${d ? `<br>${icon('flag', { size: 14 }).replace('<svg', '<svg style="display:inline;vertical-align:-2px"')} ${esc(d.label)}` : ''}</div>
      <div class="follow-lg"><span><i class="ln dash"></i>Traseul planificat</span><span><i class="ln solid"></i>Traseul parcurs</span></div>`;
  };
  const unsub = bus.on(draw);
  $('[data-x]', el).onclick = () => { unsub(); fm.remove(); el.remove(); };
}
const ORDER_TXT = o => o.status === 'anulata' ? 'Cursa a fost anulată' : 'Se caută taxi';

// ---------- SOS în timpul cursei ----------
function openSos() {
  const o = currentOrder(); if (!o) return;
  const active = o.sos && o.sos.active;
  const ov = modal(`
    <div class="panel-head"><h2>${active ? 'Alerta e activă' : 'Nu te simți în siguranță?'}</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    ${active ? `<p class="muted" style="margin-top:-6px">Dispeceratul ascultă în timp real ce se întâmplă în mașină și îți urmărește locația.</p>` : `<p class="muted" style="margin-top:-6px">Dispeceratul primește alerta pe loc, îți vede locația, iar telefonul șoferului începe să înregistreze sunetul din mașină ca să poată evalua situația.</p>`}
    <div class="vstack">
      ${active ? '' : `<button class="btn danger block xl" id="sosGo">${icon('shield')}Alertează dispeceratul</button>`}
      <div class="btn block xl" style="justify-content:space-between;cursor:default">${icon('phone')}<span class="grow" style="text-align:left">Urgență: <b>112</b></span></div>
      <button class="btn ghost block xl" id="sosShare">${icon('share')}Trimite cursa unui apropiat</button>
    </div>`);
  const go = $('#sosGo', ov);
  if (go) go.onclick = () => { bus.act('clientSos', { orderId: o.id }); ov.close(); vibrate([100, 60, 100]); toast('Dispeceratul a fost alertat. Te urmărim în timp real.', 'bad', 6000, 'shield'); };
  $('#sosShare', ov).onclick = () => { ov.close(); openShare(); };
}
document.addEventListener('click', e => { if (e.target.closest('#sosBtn')) openSos(); });

function lostItem() {
  modal(`
    <div class="panel-head"><h2>Ai uitat ceva în taxi?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin-top:0">Dispeceratul știe exact în ce mașină ai fost și îl contactează pe șofer.</p>
    <button class="btn dark block xl" id="lostCall">${icon('headset')}Sună dispeceratul</button>
    <p class="small muted center">${esc(CONFIG.company.dispatchPhone)}</p>`);
  $('#lostCall').onclick = () => { document.querySelectorAll('.overlay').forEach(x => x.remove()); calls.call({ role: 'dispecer', id: 'dispecer', name: 'Dispecerat' }); };
}

// ---------- apel și mesaje cu șoferul ----------
function callDriver() {
  const o = currentOrder(); const car = myCar(o); if (!car) return;
  calls.call({ role: 'sofer', id: car.id, name: car.driver }, o.id);
}

function openChat(orderId) {
  const o = orderId ? bus.state.orders.find(x => x.id === orderId) : currentOrder(); if (!o) return;
  const car = carById(o.carId || o.reservedBy || (o.request && o.request.carId));
  const quick = ['Ies acum', 'Sunt la intrarea principală', 'Te rog sună-mă', 'Am bagaje', 'Aștept în fața blocului'];
  const ov = modal(`
    <div class="panel-head">${car ? avatar(car.driver, car.photo, 40) : ''}<h2>${esc(car ? firstName(car.driver) + ' · ' + car.cs : 'Șoferul')}</h2>${car ? `<button class="icon-btn flat" id="chCall" aria-label="Sună">${icon('phone')}</button>` : ''}<button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="chat" id="chatList"></div>
    <div class="chips wrap mb">${quick.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="hstack"><input class="input" id="chatIn" placeholder="Scrie un mesaj…"><button class="icon-btn" style="background:var(--ink);color:var(--bg);width:56px;height:56px" id="chatSend" aria-label="Trimite">${icon('nav')}</button></div>
  `, { cls: 'chat-ov', onClose: () => unsub() });
  const draw = () => {
    const msgs = bus.state.chats[o.id] || [];
    $('#chatList', ov).innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.from === 'client' ? 'me' : 'them'}">${esc(m.text)}<div class="tm">${fmtTime(m.t)}</div></div>`).join('') : '<p class="muted center">Scrie-i șoferului dacă ai nevoie de ceva.</p>';
    $('#chatList', ov).scrollTop = 1e6;
    if (o.id === store.get('client-order', null)) ui.chatSeen = msgs.filter(m => m.from !== 'client').length;
  };
  const unsub = bus.on(draw);
  const send = text => { if (!text.trim()) return; bus.act('message', { orderId: o.id, from: 'client', text: text.trim() }); };
  $$('[data-q]', ov).forEach(b => b.onclick = () => send(b.dataset.q));
  $('#chatSend', ov).onclick = () => { send($('#chatIn', ov).value); $('#chatIn', ov).value = ''; };
  $('#chatIn', ov).onkeydown = e => { if (e.key === 'Enter') $('#chatSend', ov).click(); };
  const cc = $('#chCall', ov); if (cc) cc.onclick = () => calls.call({ role: 'sofer', id: car.id, name: car.driver }, o.id);
}

// ---------- căutare ----------
function openSearch(mode) {
  const popular = cityMap.raw.pois.filter(p => /Salina Turda$|Spitalul Municipal|^Kaufland$|Autogara|Primăria Municipiului Turda|^Lidl$|Grădina Zoologică/.test(p[0]))
    .filter((p, i, a) => a.findIndex(x => x[0] === p[0]) === i).slice(0, 6)
    .map(p => ({ label: p[0], sub: p[4] ? p[4] : CONFIG.city.name, lat: p[1], lon: p[2], type: p[3] }));
  const saved = profile.saved || {};
  const title = { pickup: 'De unde te luăm?', dest: 'Unde mergi?', 'save-home': 'Adresa de acasă', 'save-work': 'Adresa de la serviciu', 'route-from': 'Ruta nouă: de unde pleci?', 'route-to': 'Ruta nouă: unde ajungi?' }[mode];
  const el = h(`<div class="search-screen">
    <div class="search-head">
      <button class="icon-btn flat" data-x aria-label="Înapoi">${icon('back')}</button>
      <input class="input" id="q" placeholder="${title}" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="search-list" id="results"></div>
  </div>`);
  document.body.append(el);
  const q = $('#q', el), list = $('#results', el);
  setTimeout(() => q.focus(), 80);
  const close = () => el.remove();
  $('[data-x]', el).onclick = close;
  const typeIcon = t => ({ strada: 'route', adresa: 'pin', sanatate: 'plus', farmacie: 'plus', cumparaturi: 'work', magazin: 'work', mancare: 'gift', transport: 'car', turism: 'star', cartier: 'home', educatie: 'user' }[t] || 'pin');
  const row = (r, attrs) => `<button class="row" ${attrs}><span class="bubble">${icon(typeIcon(r.type), { size: 22 })}</span><span class="grow"><div class="t">${esc(r.label)}</div><div class="s">${esc(r.sub || '')}</div></span></button>`;
  let current = [];
  function draw() {
    const v = q.value.trim();
    if (v.length < 2) {
      const items = [];
      let html = '';
      if (mode === 'pickup' || mode === 'route-from') html += `<button class="row" data-gps><span class="bubble accent">${icon('locate', { size: 22 })}</span><span class="grow"><div class="t">Locația mea</div><div class="s">Folosește GPS-ul telefonului</div></span></button>`;
      html += `<button class="row" data-onmap><span class="bubble">${icon('pin', { size: 22 })}</span><span class="grow"><div class="t">Alege pe hartă</div><div class="s">Mută pinul exact unde ești</div></span></button>`;
      if (!mode.startsWith('save')) {
        const sv = ['home', 'work'].filter(k => saved[k]).map(k => ({ label: saved[k].label, sub: saved[k].address, lat: saved[k].lat, lon: saved[k].lon, type: k === 'home' ? 'cartier' : 'magazin', place: { lat: saved[k].lat, lon: saved[k].lon, label: saved[k].address } }));
        if (sv.length) { html += `<div class="sec">Salvate</div>`; sv.forEach(r => { items.push(r); html += row(r, `data-i="${items.length - 1}"`); }); }
        html += `<div class="sec">Locuri populare</div>`;
        popular.forEach(r => { items.push(r); html += row(r, `data-i="${items.length - 1}"`); });
      }
      current = items; list.innerHTML = html;
    } else {
      current = cityMap.search(v, 10);
      list.innerHTML = current.length ? current.map((r, i) => row(r, `data-i="${i}"`)).join('') : `<p class="muted center" style="padding:30px 10px">Nu am găsit „${esc(v)}”. Încearcă doar numele străzii, sau alege pe hartă.</p><button class="row" data-onmap><span class="bubble">${icon('pin', { size: 22 })}</span><span class="grow"><div class="t">Alege pe hartă</div></span></button>`;
    }
    $$('[data-i]', list).forEach(b => b.onclick = () => { const r = current[+b.dataset.i]; close(); setPlace(mode, r.place || { lat: r.lat, lon: r.lon, label: r.label }); });
    const gps = $('[data-gps]', list); if (gps) gps.onclick = () => { close(); useMyLocation(true, mode); };
    const om = $('[data-onmap]', list); if (om) om.onclick = () => { close(); startPickMap(mode); };
  }
  q.oninput = draw;
  draw();
}

// alegere pe hartă cu pin central
let centerPin;
function startPickMap(mode) {
  ui.pickMode = mode; ui.prevScreen = ui.screen === 'pickmap' ? 'home' : ui.screen;
  ui.screen = 'pickmap'; ui.lastKey = '';
  setCollapsed(false);
  render();
  if (pickupMk) { map.removeLayer(pickupMk); pickupMk = null; }
  if (destMk) { map.removeLayer(destMk); destMk = null; }
  route.clear();
  const startAt = mode === 'dest' && ui.dest ? ui.dest : ui.pickup;
  centerPin = h(`<div class="center-pin">${pinIcon(mode === 'dest' || mode === 'route-to' ? 'dest' : 'pickup', mode === 'dest' || mode === 'route-to' ? 'flag' : 'person').options.html}</div>`);
  app.append(centerPin);
  const place = () => {
    const sh = sheet.getBoundingClientRect();
    const wide = innerWidth >= 900;
    const cx = wide ? 440 + (innerWidth - 440) / 2 : innerWidth / 2;
    const cy = wide ? innerHeight / 2 : Math.max(140, sh.top / 2 + 40);
    centerPin.style.left = cx + 'px'; centerPin.style.top = cy + 'px';
    return L.point(cx, cy);
  };
  const p = place();
  map.getCenterForPin = () => map.containerPointToLatLng(place());
  const target = map.project([startAt.lat, startAt.lon], 17);
  const offset = L.point(innerWidth / 2, innerHeight / 2).subtract(p);
  map.setView(map.unproject(target.add(offset), 17), 17, { animate: false });
  const upd = () => { const c = map.getCenterForPin(); const a = $('#pickAddr'); if (a) a.textContent = cityMap.reverse([c.lat, c.lng]); centerPin.classList.remove('lift'); };
  map.on('movestart', ui._ms = () => centerPin.classList.add('lift'));
  map.on('moveend', ui._me = upd);
  upd();
}
function endPickMap() {
  if (centerPin) { centerPin.remove(); centerPin = null; }
  map.off('movestart', ui._ms); map.off('moveend', ui._me);
}

function useMyLocation(explicit, mode = 'pickup') {
  if (!navigator.geolocation) { toast('Telefonul nu permite localizarea.', 'warn'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const p = [pos.coords.latitude, pos.coords.longitude];
    const bb = cityMap.raw.bbox;
    if (p[0] < bb[0] || p[0] > bb[2] || p[1] < bb[1] || p[1] > bb[3]) {
      if (explicit) toast(`Ești în afara orașului ${CONFIG.city.name}. În demo folosim o adresă din ${CONFIG.city.name}.`, 'warn', 4500);
      fitTo([[ui.pickup.lat, ui.pickup.lon]]);
      return;
    }
    setPlace(mode, { lat: p[0], lon: p[1], label: cityMap.reverse(p), kind: 'gps' });
    fitTo([p]);
  }, () => { if (explicit) toast('Nu am primit acces la locație. Poți alege adresa din căutare.', 'warn', 4000); fitTo([[ui.pickup.lat, ui.pickup.lon]]); }, { enableHighAccuracy: true, timeout: 8000 });
}

// ---------- programare (până la 14 zile înainte) ----------
function openSchedule() {
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
  const lbl = (d, i) => i === 0 ? 'Azi' : i === 1 ? 'Mâine' : d.toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric' });
  const ov = modal(`
    <div class="panel-head"><h2>Când vrei taxiul?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="chips mb" id="days">${days.map((d, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-day="${i}">${lbl(d, i)}</button>`).join('')}</div>
    <div class="grid2">
      <label class="field"><span>Ora</span><select class="input" id="hh">${Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}</option>`).join('')}</select></label>
      <label class="field"><span>Minutul</span><select class="input" id="mm">${[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => `<option value="${m}">${String(m).padStart(2, '0')}</option>`).join('')}</select></label>
    </div>
    <div class="secure-note">${icon('calendar', { size: 20 })}<div>Un șofer poate prelua cursa din timp. Primești confirmarea cu numele lui și indicativul mașinii, iar în ziua respectivă te ridică exact la ora aleasă.</div></div>
    <button class="btn primary block xl mt" id="schedOk">Alege ora</button>
  `);
  let day = 0;
  const t = new Date(Date.now() + 45 * 60e3);
  $('#hh', ov).value = t.getHours(); $('#mm', ov).value = Math.ceil(t.getMinutes() / 5) * 5 % 60;
  $$('[data-day]', ov).forEach(b => b.onclick = () => { day = +b.dataset.day; $$('[data-day]', ov).forEach(x => x.classList.toggle('on', x === b)); });
  $('#schedOk', ov).onclick = () => {
    const d = new Date(days[day]); d.setHours(+$('#hh', ov).value, +$('#mm', ov).value, 0, 0);
    if (d.getTime() < Date.now() + 20 * 60e3) { toast('Alege o oră cu cel puțin 20 de minute de acum.', 'warn'); return; }
    ui.scheduledFor = d.getTime(); ov.close();
    if (ui.dest) goConfirm(null); else render();
  };
}

function openScheduledList() {
  const list = scheduledOrders().sort((a, b) => a.scheduledFor - b.scheduledFor);
  const ov = modal(`
    <div class="panel-head"><h2>Curse programate</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    ${list.length ? list.map(o => {
      const rc = o.reservedBy ? carById(o.reservedBy) : null;
      const pend = o.request && o.request.status === 'pending' ? carById(o.request.carId) : null;
      const st = rc ? `<span class="pill st-liber">${icon('check', { size: 14 })}Confirmat: ${esc(rc.driver)} · ${rc.cs}</span>`
        : pend ? `<span class="pill st-pauza">Așteaptă răspunsul lui ${esc(firstName(pend.driver))}</span>`
          : `<span class="pill">Căutăm un șofer care să o preia din timp</span>`;
      return `<div class="sched-item">
        <div class="hstack between"><b>${cap(dayLabel(o.scheduledFor))}, ${fmtTime(o.scheduledFor)}</b>${o.estimate ? `<span class="small muted">${o.estimate.low}–${o.estimate.high} lei</span>` : ''}</div>
        <div class="small" style="margin:4px 0 8px">${esc(o.pickup.label)}${o.dest ? ` → ${esc(o.dest.label)}` : ''}</div>
        ${st}
        <div class="hstack mt">${rc || pend ? `<button class="btn sm" data-chat="${o.id}">${icon('message', { size: 18 })}Mesaj</button><button class="btn sm" data-call="${o.id}">${icon('phone', { size: 18 })}Sună</button>` : ''}<button class="btn sm danger-soft" data-cancel="${o.id}" style="margin-left:auto">Anulează</button></div>
      </div>`;
    }).join('') : '<p class="muted center" style="padding:20px 0">Nu ai curse programate.</p>'}
  `);
  $$('[data-chat]', ov).forEach(b => b.onclick = () => { ov.close(); openChat(b.dataset.chat); });
  $$('[data-call]', ov).forEach(b => b.onclick = () => { const o = bus.state.orders.find(x => x.id === b.dataset.call); const cid = o.reservedBy || (o.request && o.request.carId); const c = carById(cid); ov.close(); calls.call({ role: 'sofer', id: c.id, name: c.driver }, o.id); });
  $$('[data-cancel]', ov).forEach(b => b.onclick = async () => {
    ov.close();
    if (await confirmBox('Anulezi cursa programată?', 'Șoferul care a preluat-o va fi anunțat.', { yes: 'Anulează', danger: true })) {
      bus.act('cancelOrder', { orderId: b.dataset.cancel, by: 'client' });
      store.set('client-scheduled', scheduledIds().filter(x => x !== b.dataset.cancel));
      ui.lastKey = ''; render();
    }
  });
}

// ---------- card bancar ----------
function luhn(num) {
  let s = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) { let d = +num[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; }
  return s % 10 === 0;
}
function brandOf(n) { if (/^4/.test(n)) return 'Visa'; if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard'; if (/^3[47]/.test(n)) return 'Amex'; return 'Card'; }
function openCardForm(after) {
  const ov = modal(`
    <div class="panel-head"><h2>Adaugă un card</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="card-visual"><div class="hstack between"><span>${icon('card')}</span><span class="brand" id="cvBrand">CARD</span></div>
      <div class="num" id="cvNum">•••• •••• •••• ••••</div>
      <div class="hstack between small"><span id="cvName">${esc((profile.name || '').toUpperCase())}</span><span id="cvExp">LL/AA</span></div></div>
    <label class="field"><span>Numărul cardului</span><input class="input" id="cn" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" maxlength="23"></label>
    <div class="grid2">
      <label class="field"><span>Expiră (LL/AA)</span><input class="input" id="ce" inputmode="numeric" autocomplete="cc-exp" placeholder="LL/AA" maxlength="5"></label>
      <label class="field"><span>CVC</span><input class="input" id="cc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></label>
    </div>
    <div class="secure-note">${icon('lock', { size: 20 })}<div>La finalul fiecărei curse plătite cu cardul, suma de pe taximetru se încasează automat și primești bonul în aplicație. Tot de pe card poți lăsa și bacșiș. <b>Demo:</b> nu se fac plăți reale; poți folosi 4242 4242 4242 4242.</div></div>
    <button class="btn primary block xl mt" id="saveCard">Salvează cardul</button>
  `);
  const cn = $('#cn', ov), ce = $('#ce', ov), cc = $('#cc', ov);
  cn.oninput = () => {
    const d = cn.value.replace(/\D/g, '').slice(0, 19);
    cn.value = d.replace(/(.{4})/g, '$1 ').trim();
    $('#cvNum', ov).textContent = (d + '•'.repeat(Math.max(0, 16 - d.length))).replace(/(.{4})/g, '$1 ').trim();
    $('#cvBrand', ov).textContent = d.length ? brandOf(d).toUpperCase() : 'CARD';
  };
  ce.oninput = () => { let d = ce.value.replace(/\D/g, '').slice(0, 4); if (d.length > 2) d = d.slice(0, 2) + '/' + d.slice(2); ce.value = d; $('#cvExp', ov).textContent = d || 'LL/AA'; };
  cc.oninput = () => { cc.value = cc.value.replace(/\D/g, '').slice(0, 4); };
  $('#saveCard', ov).onclick = () => {
    const n = cn.value.replace(/\D/g, '');
    const [mm, yy] = ce.value.split('/').map(Number);
    if (n.length < 13 || !luhn(n)) { toast('Numărul cardului nu pare corect.', 'bad'); cn.focus(); return; }
    if (!mm || mm > 12 || !yy || (2000 + yy) * 12 + mm < new Date().getFullYear() * 12 + new Date().getMonth() + 1) { toast('Data de expirare nu e validă.', 'bad'); ce.focus(); return; }
    if (cc.value.length < 3) { toast('Introdu codul CVC de pe spatele cardului.', 'bad'); cc.focus(); return; }
    profile.card = { brand: brandOf(n), last4: n.slice(-4), exp: ce.value };
    saveProfile(); ov.close();
    toast(`Card ${profile.card.brand} •••• ${profile.card.last4} salvat`, 'ok', 2500, 'check');
    after && after();
  };
}

// ---------- meniu ----------
function openMenu() {
  const ov = modal(`
    <div class="menu-head"><button class="ph-btn" id="mPhoto" aria-label="Schimbă poza">${avatar(profile.name, profile.photo, 60)}<span class="ph-edit">${icon('plus', { size: 14 })}</span></button><div class="grow"><div style="font-weight:800;font-size:1.15em">${esc(profile.name)}</div><div class="muted">${esc(profile.phone)}</div></div><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="divider"></div>
    <button class="row" id="mRoutes"><span class="bubble accent">${icon('route')}</span><span class="grow"><div class="t">Rute salvate</div><div class="s">${(profile.routes || []).length} rute</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mSched"><span class="bubble">${icon('calendar')}</span><span class="grow"><div class="t">Curse programate</div><div class="s">${scheduledOrders().length} programate</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mHistory"><span class="bubble">${icon('history')}</span><span class="grow t">Cursele mele</span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mSaved"><span class="bubble">${icon('home')}</span><span class="grow t">Adrese salvate</span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mCard"><span class="bubble">${icon('card')}</span><span class="grow"><div class="t">Plată</div><div class="s">${profile.card ? `${esc(profile.card.brand)} •••• ${esc(profile.card.last4)}` : 'Niciun card salvat'}</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <div class="row"><span class="bubble">${icon('text')}</span><span class="grow"><div class="t">Text mare</div><div class="s">Litere și butoane mai mari</div></span><button class="toggle ${profile.big ? 'on' : ''}" id="mBig" aria-label="Text mare"></button></div>
    <button class="row" id="mDisp"><span class="bubble accent">${icon('headset')}</span><span class="grow"><div class="t">Sună dispeceratul</div><div class="s">${esc(CONFIG.company.dispatchPhone)} · non-stop</div></span></button>
    <button class="row" id="mOut"><span class="bubble">${icon('logout')}</span><span class="grow t">Ieși din cont</span></button>
    <p class="small muted center mt">${esc(CONFIG.company.name)} · ${esc(CONFIG.city.name)}</p>
  `);
  $('#mPhoto', ov).onclick = async () => { const ph = await pickPhoto(); if (!ph) return; profile.photo = ph; saveProfile(); bus.act('setPhoto', { role: 'client', phone: profile.phone, name: profile.name, photo: ph }); ov.close(); toast('Poza a fost salvată. Șoferii o văd când primesc comanda ta.', 'ok', 3000, 'check'); };
  $('#mBig', ov).onclick = e => { profile.big = !profile.big; saveProfile(); applyTextSize(profile.big); e.currentTarget.classList.toggle('on', profile.big); ui.lastKey = ''; render(); };
  $('#mRoutes', ov).onclick = () => { ov.close(); openRoutes(); };
  $('#mSched', ov).onclick = () => { ov.close(); openScheduledList(); };
  $('#mHistory', ov).onclick = () => { ov.close(); openHistory(); };
  $('#mSaved', ov).onclick = () => { ov.close(); openSaved(); };
  $('#mCard', ov).onclick = () => { ov.close(); openPayments(); };
  $('#mDisp', ov).onclick = () => { ov.close(); calls.call({ role: 'dispecer', id: 'dispecer', name: 'Dispecerat' }); };
  $('#mOut', ov).onclick = async () => { ov.close(); if (await confirmBox('Ieși din cont?', 'Datele tale rămân salvate pe telefon până intri din nou.', { yes: 'Ieși' })) { store.set('client-profile', null); location.reload(); } };
}

function openHistory() {
  const hist = profile.history || [];
  modal(`
    <div class="panel-head"><h2>Cursele mele</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    ${hist.length ? hist.map(x => `<div class="row"><span class="bubble">${icon(x.payment === 'card' ? 'card' : 'cash')}</span><span class="grow"><div class="t">${esc(x.dest ? x.dest.label : 'Cursă')}</div><div class="s">${new Date(x.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}, ${fmtTime(x.t)} · taxi ${x.cs || ''}${x.stars ? ` · ${'★'.repeat(x.stars)}` : ''}${x.tip ? ` · bacșiș ${fmtMoney(x.tip)}` : ''}</div></span><b>${fmtMoney(x.fare)} lei</b></div>`).join('') : '<p class="muted center" style="padding:30px 0">Încă nu ai curse. Prima e la o atingere distanță!</p>'}
  `);
}

function openSaved() {
  const s = profile.saved || {};
  const ov = modal(`
    <div class="panel-head"><h2>Adrese salvate</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <button class="row" data-k="home"><span class="bubble">${icon('home')}</span><span class="grow"><div class="t">Acasă</div><div class="s">${s.home ? esc(s.home.address) : 'Adaugă adresa'}</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" data-k="work"><span class="bubble">${icon('work')}</span><span class="grow"><div class="t">Serviciu</div><div class="s">${s.work ? esc(s.work.address) : 'Adaugă adresa'}</div></span>${icon('chevron', { cls: 'muted' })}</button>
  `);
  $$('[data-k]', ov).forEach(b => b.onclick = () => { ov.close(); openSearch('save-' + b.dataset.k); });
}

function openPayments() {
  const ov = modal(`
    <div class="panel-head"><h2>Plată</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    ${profile.card ? `<div class="card-visual"><div class="hstack between"><span>${icon('card')}</span><span class="brand">${esc(profile.card.brand.toUpperCase())}</span></div><div class="num">•••• •••• •••• ${esc(profile.card.last4)}</div><div class="small">Expiră ${esc(profile.card.exp)}</div></div>
      <div class="secure-note">${icon('check', { size: 20 })}<div>Cursele plătite cu cardul se încasează automat la final. Bonul apare în „Cursele mele”.</div></div>
      <button class="btn ghost block mt" id="cardDel">Șterge cardul</button>` : `<p class="muted">Adaugă un card ca să nu mai ai nevoie de bani cash. Suma se ia automat la finalul cursei.</p>`}
    <button class="btn primary block xl mt" id="cardAdd">${profile.card ? 'Înlocuiește cardul' : 'Adaugă card'}</button>
  `);
  $('#cardAdd', ov).onclick = () => { ov.close(); openCardForm(); };
  const del = $('#cardDel', ov); if (del) del.onclick = () => { profile.card = null; if (ui.payment === 'card') ui.payment = 'cash'; saveProfile(); ov.close(); toast('Cardul a fost șters.'); ui.lastKey = ''; render(); };
}

// ---------- prima pornire ----------
function showOnboarding() {
  const d = CONFIG.demoClient;
  const ov = modal(`
    <div class="center" style="padding:6px 0 10px">
      <div class="boot-logo" style="margin:0 auto 14px;animation:none">${icon('car', { size: 34 })}</div>
      <h2 style="margin:0 0 6px;font-size:1.6em">Bun venit la ${esc(CONFIG.company.name)}</h2>
      <p class="muted" style="margin:0">${esc(CONFIG.company.tagline)}</p>
    </div>
    <label class="field"><span>Numele tău</span><input class="input" id="obName" value="${esc(d.name)}" autocomplete="name"></label>
    <label class="field"><span>Telefon (te sună șoferul doar dacă e nevoie)</span><input class="input" id="obPhone" value="${esc(d.phone)}" inputmode="tel" autocomplete="tel"></label>
    <div class="row" style="border:0"><span class="bubble">${icon('text')}</span><span class="grow"><div class="t">Text mare</div><div class="s">Recomandat dacă vezi mai greu scrisul mic</div></span><button class="toggle" id="obBig" aria-label="Text mare"></button></div>
    <button class="btn primary block xl mt" id="obGo">Continuă</button>
    <p class="small muted center">Continuând, ești de acord cu termenii și politica de confidențialitate.</p>
  `, { cls: 'onboard', locked: true });
  let big = false;
  $('#obBig', ov).onclick = e => { big = !big; e.currentTarget.classList.toggle('on', big); applyTextSize(big); };
  $('#obGo', ov).onclick = () => {
    const name = $('#obName', ov).value.trim(), phone = $('#obPhone', ov).value.trim();
    if (name.length < 2) { toast('Scrie-ți numele, te rog.', 'warn'); return; }
    if (phone.replace(/\D/g, '').length < 9) { toast('Numărul de telefon pare incomplet.', 'warn'); return; }
    profile = { name, phone, big, card: null, photo: null, saved: { home: d.home, work: d.work }, routes: JSON.parse(JSON.stringify(d.routes || [])), history: [] };
    saveProfile(); ov.remove(); ui.lastKey = ''; render();
  };
}

let resizeT;
addEventListener('resize', () => {
  layoutAround();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { map.invalidateSize(); const o = currentOrder(); const scr = screenFor(o); if (scr !== 'pickmap') updateMapForScreen(scr, o); }, 150);
});

// ---------- pornire ----------
if (profile && !profile.routes) { profile.routes = JSON.parse(JSON.stringify(CONFIG.demoClient.routes || [])); saveProfile(); }
bus.on(onState);
boot.done();
if (!profile) showOnboarding();
