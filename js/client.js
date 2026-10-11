// Aplicația CLIENT
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, estimateFare, perKm, etaSeconds, remainingRoute, uid, STATUS } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, legendHtml, cssVar } from './mapview.js';
import { icon } from './icons.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtClock, fmtMoney, firstName, beep, vibrate, store, applyTextSize, loadingScreen, unlockAudio } from './ui.js';

const L = window.L;
const T = CONFIG.tariff;
const boot = loadingScreen();
unlockAudio();

let profile = store.get('client-profile', null);
applyTextSize(profile && profile.big);
document.title = CONFIG.company.name;

let cityMap, bus, map, fleet, route, pickupMk, destMk;
const ui = {
  screen: 'home', pickup: null, dest: null, payment: 'cash', options: {}, note: '', scheduledFor: null,
  lastKey: '', lastStatus: null, chatSeen: 0, rated: {},
};

try {
  cityMap = await CityMap.load();
} catch (e) { boot.fail('Nu am putut încărca harta. Verifică internetul.'); throw e; }

const app = $('#app');
map = createMap($('#map'), { cityMap });
route = new RouteLine(map, cssVar('--ink'));
bus = await connect(cityMap, { role: 'client' });
window.taxiDemo = bus;

fleet = new FleetLayer(map, {
  me: null,
  dim: car => { const o = currentOrder(); return !!(o && o.carId && car.id !== o.carId && ['acceptata', 'sosit', 'in_cursa'].includes(o.status)); },
  filter: car => car.status !== STATUS.offline && car.status !== STATUS.pauza,
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
  <div class="sheet client-sheet" id="sheet"><div class="grab"></div><div id="sheetBody"></div></div>
  <div class="demo-badge">DEMO · viteză x<span id="spd">1</span></div>
`);
const sheet = $('#sheet'), body = $('#sheetBody');
$('#menuBtn').onclick = openMenu;
$('#locateBtn').onclick = () => useMyLocation(true);

// locația de pornire: ultima folosită, „Acasă” sau centrul
const lastPickup = store.get('client-last-pickup', null);
ui.payment = profile && profile.card ? 'card' : 'cash';
ui.pickup = lastPickup || { ...CONFIG.demoClient.home, label: CONFIG.demoClient.home.address, kind: 'saved' };


// ---------- stare ----------
function currentOrder() {
  const id = store.get('client-order', null);
  if (!id || !bus.state) return null;
  return bus.state.orders.find(o => o.id === id) || null;
}
function myCar(o = currentOrder()) { return o && o.carId ? bus.state.cars.find(c => c.id === o.carId) : null; }

function screenFor(o) {
  if (!o) return ui.screen;
  switch (o.status) {
    case 'programata': return 'scheduled';
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
  const o = currentOrder();
  if (o && o.status === 'anulata' && o.cancelledBy === 'client') { store.set('client-order', null); }
  if (!o && store.get('client-order', null)) store.set('client-order', null);
  // notificări la schimbarea stării
  if (o && ui.lastStatus && o.status !== ui.lastStatus) notifyStatus(o);
  ui.lastStatus = o ? o.status : null;
  // mesaje noi de la șofer
  if (o) {
    const msgs = (state.chats[o.id] || []).filter(m => m.from !== 'client');
    if (msgs.length > ui.chatSeen && !document.querySelector('.overlay.chat-ov')) {
      const m = msgs[msgs.length - 1];
      if (ui.lastMsgT !== m.t) { toast(`<b>${esc(firstName(myCar(o)?.driver || 'Șoferul'))}:</b> ${esc(m.text)}`, '', 4500, 'message'); beep([990, .1]); vibrate(80); ui.lastMsgT = m.t; }
    }
  }
  render();
}

function notifyStatus(o) {
  const car = myCar(o);
  if (o.status === 'acceptata') { toast(`Taxi găsit! ${car ? car.plate : ''} vine spre tine.`, 'ok', 4000, 'car'); beep([660, .1, 990, .15]); vibrate([60, 40, 60]); }
  if (o.status === 'sosit') { toast('Taxiul a ajuns și te așteaptă.', 'ok', 5000, 'pin'); beep([880, .15, 880, .15, 1320, .25], .25); vibrate([200, 100, 200]); }
  if (o.status === 'finalizata') { beep([1320, .12, 990, .18]); }
  if (o.status === 'anulata' && o.cancelledBy !== 'client') { toast('Comanda a fost anulată.', 'bad'); vibrate(200); }
}

// ---------- randare ----------
function render() {
  if (!profile) return;
  const o = currentOrder();
  const scr = screenFor(o);
  const key = scr + '|' + (o ? o.id + o.status + (o.carId || '') : '') + '|' + (ui.pickup && ui.pickup.label) + '|' + (ui.dest && ui.dest.label) + '|' + ui.payment + '|' + JSON.stringify(ui.options) + '|' + ui.scheduledFor + '|' + (profile.card ? profile.card.last4 : '');
  if (key !== ui.lastKey) {
    ui.lastKey = key;
    ui.chatSeenRendered = null;
    body.innerHTML = SCREENS[scr](o);
    bindCommon();
    BIND[scr] && BIND[scr](o);
    updateMapForScreen(scr, o);
    requestAnimationFrame(() => layoutAround());
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
  const opts = wide
    ? { paddingTopLeft: [480, 90], paddingBottomRight: [60, 60], maxZoom: 16, animate: true }
    : { paddingTopLeft: [40, 120], paddingBottomRight: [40, innerHeight - sh.top + 30], maxZoom: 16, animate: true };
  if (points.length === 1) {
    const b = L.latLng(points[0]).toBounds(500);
    map.fitBounds(b, opts);
  } else map.fitBounds(L.latLngBounds(points), opts);
}

function updateMapForScreen(scr, o) {
  const pickup = o ? o.pickup : ui.pickup;
  const dest = o ? (o.dest || o.destInCar) : ui.dest;
  // pin de preluare
  if (pickup && scr !== 'inride' && scr !== 'done') {
    if (!pickupMk) pickupMk = L.marker([pickup.lat, pickup.lon], { icon: pinIcon('pickup', 'person'), zIndexOffset: 2000, keyboard: false }).addTo(map);
    pickupMk.setLatLng([pickup.lat, pickup.lon]);
  } else if (pickupMk) { map.removeLayer(pickupMk); pickupMk = null; }
  // pin de destinație
  if (dest && ['confirm', 'inride', 'searching', 'assigned', 'arrived', 'scheduled'].includes(scr)) {
    if (!destMk) destMk = L.marker([dest.lat, dest.lon], { icon: pinIcon('dest', 'flag'), zIndexOffset: 1900, keyboard: false }).addTo(map);
    destMk.setLatLng([dest.lat, dest.lon]);
  } else if (destMk) { map.removeLayer(destMk); destMk = null; }

  fleet.opts.me = o && o.carId ? o.carId : null;
  fleet.update(bus.state);
  route.setDashed(false);
  if (scr === 'confirm' && ui.dest) {
    const r = cityMap.route([ui.pickup.lat, ui.pickup.lon], [ui.dest.lat, ui.dest.lon]);
    route.set(r.pts, cssVar('--ink'));
    fitTo(r.pts);
  } else if (scr === 'home' || scr === 'confirm' || scr === 'searching' || scr === 'scheduled') {
    route.clear();
    const near = freeCarsNear(pickup, 1800).slice(0, 3).map(c => carPos(c).p);
    fitTo([[pickup.lat, pickup.lon], ...near]);
  } else if (scr === 'assigned' || scr === 'arrived' || scr === 'inride') {
    const car = myCar(o);
    if (car) {
      const pts = remainingRoute(car);
      route.set(pts, scr === 'inride' ? cssVar('--busy') : cssVar('--to'));
      fitTo(pts.length > 1 ? pts : [carPos(car).p, [pickup.lat, pickup.lon]]);
    }
  } else { route.clear(); }
}

let lastDyn = 0, lastRoute = 0;
function frame(now) {
  if (now - lastDyn > 500) { lastDyn = now; const o = currentOrder(); refreshDynamic(screenFor(o), o); }
  if (now - lastRoute > 1200) {
    lastRoute = now;
    const o = currentOrder();
    const car = myCar(o);
    if (car && o && ['acceptata', 'in_cursa'].includes(o.status)) route.set(remainingRoute(car));
  }
}

function freeCarsNear(p, radius = 3000) {
  if (!bus.state || !p) return [];
  return bus.state.cars.filter(c => c.status === STATUS.liber && !c.offerId)
    .map(c => ({ c, d: dist(carPos(c).p, [p.lat, p.lon]) }))
    .filter(x => x.d <= radius).sort((a, b) => a.d - b.d).map(x => x.c);
}
function nearestEtaSec(p) {
  const cars = freeCarsNear(p, 8000);
  if (!cars.length) return null;
  const d = dist(carPos(cars[0]).p, [p.lat, p.lon]) * 1.35;
  return d / (CONFIG.demo.avgSpeedKmh / 3.6 * (bus.state.speedMul || 1)) + 30;
}

function refreshDynamic(scr, o) {
  const st = bus.state; if (!st) return;
  // legenda cu numărul de mașini
  const counts = {};
  for (const c of st.cars) { if (c.status === STATUS.offline) continue; const k = c.status === STATUS.liber ? (c.station && !c.move ? 'liber_statie' : 'liber_drum') : c.status; counts[k] = (counts[k] || 0) + 1; }
  const lg = $('#legend'); const html = legendHtml(counts, innerWidth < 380);
  if (lg.dataset.h !== html) { lg.innerHTML = html; lg.dataset.h = html; }
  lg.parentElement.hidden = !['home', 'confirm'].includes(scr);

  const near = $('[data-near]');
  if (near && ui.pickup) {
    const n = freeCarsNear(ui.pickup, 2500).length;
    const eta = nearestEtaSec(ui.pickup);
    near.innerHTML = n ? `<span class="live"></span>${n} ${n === 1 ? 'taxi liber' : 'taxiuri libere'} aproape · cel mai apropiat în ${fmtMin(eta)}` : `<span class="live" style="background:var(--to)"></span>Toate mașinile sunt ocupate acum – comanda intră la rând`;
  }
  const car = myCar(o);
  $$('[data-eta]').forEach(el => {
    if (!car) return;
    const sec = etaSeconds(car);
    el.textContent = String(Math.max(1, Math.round(sec / 60)));
  });
  $$('[data-arrive-at]').forEach(el => { if (car) el.textContent = fmtTime(Date.now() + etaSeconds(car) * 1000 / 1); });
  $$('[data-dist]').forEach(el => { if (car && car.move) el.textContent = fmtKm(carPos(car).remaining); });
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
const SCREENS = {
  home() {
    const saved = profile.saved || {};
    const recent = (profile.history || []).map(x => x.dest).filter(Boolean).filter((d, i, a) => a.findIndex(y => y.label === d.label) === i).slice(0, 3);
    return `
      <div class="hello">Bună, ${esc(firstName(profile.name))}!</div>
      <h2 class="q">Unde mergem?</h2>
      <div class="where-stack">
        <button class="where" data-pick="pickup">
          <span class="dot"></span>
          <span class="grow"><span class="lbl">Te luăm de la</span><div class="val">${esc(ui.pickup.label)}</div></span>
          <span class="muted small">Schimbă</span>
        </button>
        <button class="where" data-pick="dest">
          <span class="dot dest"></span>
          <span class="grow"><span class="lbl">Destinație (opțional)</span><div class="val muted">Caută adresa sau locul</div></span>
          ${icon('search', { cls: 'muted' })}
        </button>
      </div>
      <div class="chips mt">
        ${saved.home ? `<button class="chip" data-quick="home">${icon('home', { size: 20 })}Acasă</button>` : ''}
        ${saved.work ? `<button class="chip" data-quick="work">${icon('work', { size: 20 })}Serviciu</button>` : ''}
        ${recent.map((d, i) => `<button class="chip" data-recent="${i}">${icon('history', { size: 20 })}${esc(d.label)}</button>`).join('')}
      </div>
      <div class="near" data-near></div>
      <button class="btn primary block xl big-cta" id="orderHere">${icon('car', { size: 26 })}Vreau taxi aici</button>
    `;
  },

  confirm() {
    const est = ui.dest ? ui.estimate : null;
    const card = profile.card;
    const opts = [
      ['bigTrunk', 'luggage', 'Portbagaj mare'],
      ['pet', 'paw', 'Animal de companie'],
      ['childSeat', 'baby', 'Scaun copil'],
      ['help', 'help', 'Ajutor la urcare'],
    ];
    const when = ui.scheduledFor ? `${sameDay(ui.scheduledFor) ? 'Azi' : 'Mâine'}, ${fmtTime(ui.scheduledFor)}` : 'Acum';
    return `
      <div class="hstack mb"><button class="icon-btn flat" data-back aria-label="Înapoi">${icon('back')}</button><h2 style="margin:0">Confirmă comanda</h2></div>
      <div class="where-stack">
        <button class="where" data-pick="pickup"><span class="dot"></span><span class="grow"><span class="lbl">De la</span><div class="val">${esc(ui.pickup.label)}</div></span>${icon('chevron', { cls: 'muted', size: 20 })}</button>
        <button class="where" data-pick="dest"><span class="dot dest"></span><span class="grow"><span class="lbl">Până la</span><div class="val ${ui.dest ? '' : 'muted'}">${ui.dest ? esc(ui.dest.label) : 'Spui șoferului în mașină'}</div></span>${icon('chevron', { cls: 'muted', size: 20 })}</button>
      </div>
      <div class="estimate">
        ${est
          ? `<div><div class="small muted" style="font-weight:700">Preț estimat</div><div class="price">${est.low}–${est.high} lei</div></div><div class="meta">${est.km.toLocaleString('ro-RO')} km<br>~${est.minutes} min</div>`
          : `<div><div class="small muted" style="font-weight:700">Plătești după taximetru</div><div class="price" style="font-size:1.35em">${fmtMoney(perKm())} lei/km</div></div><div class="meta">Pornire ${fmtMoney(T.start)} lei<br>Adaugă destinația<br>pentru preț estimat</div>`}
      </div>
      <h3 style="margin-top:4px">Cum plătești?</h3>
      <div class="seg">
        <button data-pay="cash" class="${ui.payment === 'cash' ? 'on' : ''}">${icon('cash')}Cash</button>
        <button data-pay="card" class="${ui.payment === 'card' ? 'on' : ''}">${icon('card')}${card ? `Card <span class="sub">•••• ${card.last4}</span>` : 'Card'}</button>
      </div>
      ${ui.payment === 'card' ? `<p class="small muted" style="margin:8px 2px 0">${icon('lock', { size: 16, cls: '' }).replace('class="ic ', 'style="display:inline;vertical-align:-3px" class="ic ')} Suma de pe taximetru se ia automat de pe card la finalul cursei.</p>` : ''}
      <details class="more" ${Object.values(ui.options).some(Boolean) || ui.note ? 'open' : ''}>
        <summary>${icon('chevron', { size: 20 })}Opțiuni și mesaj pentru șofer</summary>
        <div class="opts">
          ${opts.map(([k, ic, label]) => `<button class="opt ${ui.options[k] ? 'on' : ''}" data-opt="${k}">${icon(ic, { size: 22 })}<span>${label}</span><span class="ck">${icon('check', { size: 16, stroke: 3 })}</span></button>`).join('')}
        </div>
        <label class="field mt"><span>Mesaj pentru șofer</span><input class="input" id="note" placeholder="ex. Bloc B2, scara 3, etajul 4" value="${esc(ui.note)}"></label>
      </details>
      <div class="hstack mt">
        <button class="chip" id="whenBtn">${icon('clock', { size: 20 })}${when}</button>
        ${ui.scheduledFor ? `<button class="chip" id="whenClear">${icon('close', { size: 18 })}Acum</button>` : ''}
      </div>
      <button class="btn primary block xl mt" id="placeOrder">${ui.scheduledFor ? 'Programează taxiul' : 'Comandă taxi'}${est ? ` · ${est.low}–${est.high} lei` : ''}</button>
    `;
  },

  searching(o) {
    return `
      <div class="radar"><div class="core">${icon('car', { size: 30 })}</div></div>
      <h2 class="center" style="margin:0 0 6px">Căutăm cel mai apropiat taxi…</h2>
      <p class="center muted" style="margin:0 0 6px">De obicei durează câteva secunde. <span data-search-t></span></p>
      <div class="where-stack mt">
        <div class="where"><span class="dot"></span><span class="grow"><span class="lbl">De la</span><div class="val">${esc(o.pickup.label)}</div></span></div>
        ${o.dest ? `<div class="where"><span class="dot dest"></span><span class="grow"><span class="lbl">Până la</span><div class="val">${esc(o.dest.label)}</div></span>${o.estimate ? `<b>${o.estimate.low}–${o.estimate.high} lei</b>` : ''}</div>` : ''}
      </div>
      <button class="linkbtn danger mt" id="cancelOrder">Anulează comanda</button>
    `;
  },

  scheduled(o) {
    return `
      <div class="center" style="padding:8px 0"><div class="bubble accent" style="margin:0 auto 10px;width:64px;height:64px;border-radius:20px">${icon('calendar', { size: 30 })}</div>
      <h2 style="margin:0 0 4px">Taxi programat</h2>
      <p class="muted" style="margin:0">${sameDay(o.scheduledFor) ? 'Azi' : 'Mâine'} la <b>${fmtTime(o.scheduledFor)}</b>. Îți trimitem mașina cu câteva minute înainte.</p></div>
      <div class="where-stack mt">
        <div class="where"><span class="dot"></span><span class="grow"><span class="lbl">De la</span><div class="val">${esc(o.pickup.label)}</div></span></div>
        ${o.dest ? `<div class="where"><span class="dot dest"></span><span class="grow"><span class="lbl">Până la</span><div class="val">${esc(o.dest.label)}</div></span></div>` : ''}
      </div>
      <button class="linkbtn danger mt" id="cancelOrder">Anulează programarea</button>
    `;
  },

  assigned(o) {
    const car = myCar(o);
    return `
      <div class="hstack between">
        <div><div class="muted small" style="font-weight:700">Taxiul ajunge în</div><div class="eta-big"><span class="n" data-eta>–</span><span class="u" data-eta-u>min</span></div></div>
        ${carPlate(car)}
      </div>
      ${carCard(car)}
      ${actions(o)}
      ${o.payment === 'card' ? `<p class="small muted center" style="margin:12px 0 0">Plată cu cardul •••• ${esc(o.card ? o.card.last4 : '')} – automat la final</p>` : `<p class="small muted center" style="margin:12px 0 0">Plată cash la șofer${o.estimate ? ` · estimat ${o.estimate.low}–${o.estimate.high} lei` : ''}</p>`}
      <button class="linkbtn danger" id="cancelOrder">Anulează comanda</button>
    `;
  },

  arrived(o) {
    const car = myCar(o);
    return `
      <div class="arrived-banner">${icon('pin', { size: 34 })}<div><div class="t">Taxiul te așteaptă!</div><div>Caută mașina ${esc(car ? car.color : '')} cu numărul:</div></div></div>
      <div class="center" style="margin:6px 0 12px">${carPlate(car, true)}</div>
      ${carCard(car)}
      <p class="center free-wait" data-wait></p>
      <button class="btn dark block xl" data-quickmsg="Ies acum, ajung în 1-2 minute">${icon('message')}Spune-i „Ies acum”</button>
      <div class="mt">${actions(o)}</div>
    `;
  },

  inride(o) {
    const dest = o.dest || o.destInCar;
    return `
      <div class="muted small" style="font-weight:700">${o.dest ? 'În drum spre' : 'În cursă'}</div>
      <h2 style="margin:2px 0 10px">${esc(dest ? dest.label : 'Destinația spusă șoferului')}</h2>
      <div class="grid2">
        <div class="stat"><div class="k">Ajungi la</div><div class="v" data-arrive-at>–</div></div>
        <div class="stat"><div class="k">${o.estimate ? 'Preț estimat' : 'Tarif'}</div><div class="v">${o.estimate ? `${o.estimate.low}–${o.estimate.high} lei` : `${fmtMoney(perKm())} lei/km`}</div></div>
      </div>
      ${carCard(myCar(o))}
      <div class="actions3">
        <button class="act" id="shareRide">${icon('share')}Trimite familiei</button>
        <button class="act" data-chat>${icon('message')}Mesaj<span class="badge" data-unread hidden></span></button>
        <button class="act" id="sosBtn" style="color:var(--danger)">${icon('shield')}Ajutor</button>
      </div>
    `;
  },

  done(o) {
    const car = myCar(o) || {};
    const paidCard = o.payment === 'card';
    const stars = ui.rated[o.id] || 0;
    return `
      <div class="receipt">
        <div class="muted" style="font-weight:700">Ai ajuns! Total cursă</div>
        <div class="total">${fmtMoney(o.fare)} lei</div>
        ${paidCard
          ? `<div class="paid-ok">${icon('check', { size: 20, stroke: 2.6 })}Plătit automat · ${esc(o.card ? o.card.brand : 'Card')} •••• ${esc(o.card ? o.card.last4 : '')}</div>`
          : `<div class="paid-cash">${icon('cash', { size: 20 })}Plătește șoferului cash</div>`}
        <div class="small muted mt">${o.rideMeters ? fmtKm(o.rideMeters) + ' · ' : ''}${esc(car.plate || '')} · ${esc(car.driver || '')}</div>
      </div>
      <div class="divider"></div>
      <h3 class="center" style="margin:0">Cum a fost cursa cu ${esc(firstName(car.driver))}?</h3>
      <div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= stars ? 'on' : ''}" aria-label="${i} stele">${icon('star', { size: 40, stroke: 1.6 })}</button>`).join('')}</div>
      <div class="chips wrap" style="justify-content:center" ${stars ? '' : 'hidden'} id="tags">
        ${['Șofer amabil', 'Mașină curată', 'Condus atent', 'Punctual'].map(t => `<button class="chip" data-tag="${t}">${t}</button>`).join('')}
      </div>
      <button class="btn primary block xl mt" id="doneBtn">Gata</button>
      <button class="linkbtn" id="lostBtn">Am uitat ceva în mașină</button>
    `;
  },

  cancelled(o) {
    return `
      <div class="center" style="padding:8px 0">
        <div class="bubble" style="margin:0 auto 10px;width:64px;height:64px;border-radius:20px;background:var(--danger-soft);color:var(--danger)">${icon('alert', { size: 30 })}</div>
        <h2 style="margin:0 0 6px">Comanda a fost anulată</h2>
        <p class="muted" style="margin:0">${esc(o.cancelReason || 'Ne pare rău pentru neplăcere.')}</p>
      </div>
      <button class="btn primary block xl mt" id="reorder">Comandă din nou</button>
      <button class="btn ghost block mt" id="closeCancelled">Închide</button>
    `;
  },

  pickmap() {
    return `
      <h2 style="margin:0 0 4px">${ui.pickMode === 'dest' ? 'Alege destinația' : 'De unde te luăm?'}</h2>
      <p class="muted small" style="margin:0 0 12px">Mută harta până când pinul e exact pe loc.</p>
      <div class="where"><span class="dot ${ui.pickMode === 'dest' ? 'dest' : ''}"></span><span class="grow"><div class="val" id="pickAddr">…</div></span></div>
      <button class="btn primary block xl mt" id="pickOk">Confirmă locul</button>
      <button class="btn ghost block mt" data-back>Renunță</button>
    `;
  },
};

function carPlate(car, big = false) {
  if (!car) return '';
  return `<span class="plate" style="${big ? 'font-size:1.6em' : ''}"><span class="eu">RO</span><span class="num">${esc(car.plate)}</span></span>`;
}
function carCard(car) {
  if (!car) return '';
  const ini = car.driver.split(' ').map(x => x[0]).join('').slice(0, 2);
  return `<div class="car-card"><div class="avatar">${ini}</div><div class="grow">
    <div class="who">${esc(car.driver)} <span class="rating">${icon('star', { size: 16 })}${car.rating.toLocaleString('ro-RO')}</span></div>
    <div class="what">${esc(car.model)} ${esc(car.color)} · ${car.years} ani experiență</div></div></div>`;
}
function actions(o) {
  return `<div class="actions3">
    <button class="act" data-call>${icon('phone')}Sună</button>
    <button class="act" data-chat>${icon('message')}Mesaj<span class="badge" data-unread hidden></span></button>
    <button class="act" id="shareRide">${icon('share')}Trimite familiei</button>
  </div>`;
}
const sameDay = t => new Date(t).toDateString() === new Date().toDateString();

// ---------- evenimente ----------
function bindCommon() {
  $$('[data-pick]', body).forEach(b => b.onclick = () => openSearch(b.dataset.pick));
  $$('[data-back]', body).forEach(b => b.onclick = () => { ui.screen = 'home'; ui.lastKey = ''; render(); });
  $$('[data-call]', body).forEach(b => b.onclick = callDriver);
  $$('[data-chat]', body).forEach(b => b.onclick = openChat);
  $$('[data-quickmsg]', body).forEach(b => b.onclick = () => { const o = currentOrder(); if (o) { bus.act('message', { orderId: o.id, from: 'client', text: b.dataset.quickmsg }); toast('Mesaj trimis șoferului', 'ok', 2000, 'check'); } });
  const share = $('#shareRide', body); if (share) share.onclick = shareRide;
  const cancel = $('#cancelOrder', body); if (cancel) cancel.onclick = cancelOrder;
}

const BIND = {
  home() {
    $('#orderHere').onclick = () => goConfirm(null);
    $$('[data-quick]').forEach(b => b.onclick = () => { const s = profile.saved[b.dataset.quick]; goConfirm({ lat: s.lat, lon: s.lon, label: s.label === 'Acasă' || s.label === 'Serviciu' ? s.address : s.label }); });
    const recent = (profile.history || []).map(x => x.dest).filter(Boolean).filter((d, i, a) => a.findIndex(y => y.label === d.label) === i).slice(0, 3);
    $$('[data-recent]').forEach(b => b.onclick = () => goConfirm(recent[+b.dataset.recent]));
  },
  confirm() {
    $$('[data-pay]').forEach(b => b.onclick = () => {
      if (b.dataset.pay === 'card' && !profile.card) { openCardForm(() => { ui.payment = 'card'; render(); }); return; }
      ui.payment = b.dataset.pay; render();
    });
    $$('[data-opt]').forEach(b => b.onclick = () => { ui.options[b.dataset.opt] = !ui.options[b.dataset.opt]; render(); });
    const note = $('#note'); if (note) note.oninput = () => { ui.note = note.value; };
    $('#whenBtn').onclick = openSchedule;
    const wc = $('#whenClear'); if (wc) wc.onclick = () => { ui.scheduledFor = null; render(); };
    $('#placeOrder').onclick = placeOrder;
  },
  arrived() {},
  done(o) {
    $$('[data-star]').forEach(b => b.onclick = () => {
      ui.rated[o.id] = +b.dataset.star;
      $$('[data-star]').forEach(x => x.classList.toggle('on', +x.dataset.star <= ui.rated[o.id]));
      $('#tags').hidden = false;
    });
    $$('[data-tag]').forEach(b => b.onclick = () => b.classList.toggle('on'));
    $('#doneBtn').onclick = () => {
      const tags = $$('[data-tag].on').map(b => b.dataset.tag);
      if (ui.rated[o.id]) bus.act('rateOrder', { orderId: o.id, stars: ui.rated[o.id], tags });
      saveHistory(o, ui.rated[o.id]);
      store.set('client-order', null);
      ui.dest = null; ui.screen = 'home'; ui.lastKey = ''; ui.chatSeen = 0;
      if (ui.rated[o.id]) toast('Mulțumim! Ne bucurăm că ai ales ' + esc(CONFIG.company.name) + '.', 'ok');
      render();
    };
    $('#lostBtn').onclick = lostItem;
  },
  cancelled(o) {
    $('#reorder').onclick = () => { ui.pickup = o.pickup; ui.dest = o.dest; store.set('client-order', null); goConfirm(o.dest); };
    $('#closeCancelled').onclick = () => { store.set('client-order', null); ui.screen = 'home'; ui.lastKey = ''; render(); };
  },
  pickmap() {
    $('#pickOk').onclick = () => {
      const c = map.getCenterForPin();
      const place = { lat: c.lat, lon: c.lng, label: cityMap.reverse([c.lat, c.lng]), kind: 'map' };
      endPickMap();
      setPlace(ui.pickMode, place);
    };
    $$('[data-back]').forEach(b => b.onclick = () => { endPickMap(); ui.screen = ui.prevScreen || 'home'; ui.lastKey = ''; render(); });
  },
};

// ---------- fluxuri ----------
function goConfirm(dest) {
  if (dest) ui.dest = dest;
  ui.estimate = ui.dest ? estimateFare(cityMap.route([ui.pickup.lat, ui.pickup.lon], [ui.dest.lat, ui.dest.lon]).meters) : null;
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
  }
  if (ui.screen === 'confirm' || mode === 'dest') goConfirm(null);
  else { ui.lastKey = ''; render(); }
}

function placeOrder() {
  if (ui.payment === 'card' && !profile.card) { openCardForm(placeOrder); return; }
  const id = uid('o');
  const payload = {
    id, source: 'app',
    client: { name: profile.name, phone: profile.phone },
    pickup: { lat: ui.pickup.lat, lon: ui.pickup.lon, label: ui.pickup.label },
    dest: ui.dest ? { lat: ui.dest.lat, lon: ui.dest.lon, label: ui.dest.label } : null,
    note: ui.note.trim(), options: { ...ui.options }, payment: ui.payment,
    card: ui.payment === 'card' ? { brand: profile.card.brand, last4: profile.card.last4 } : null,
    estimate: ui.estimate, scheduledFor: ui.scheduledFor,
  };
  store.set('client-order', id);
  ui.chatSeen = 0; ui.lastStatus = ui.scheduledFor ? 'programata' : 'cautare';
  bus.act('createOrder', payload);
  ui.note = ''; ui.options = {}; ui.scheduledFor = null; ui.screen = 'home';
  if (payload.scheduledFor) toast('Taxi programat. Te anunțăm când pleacă mașina.', 'ok');
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
  profile.history.unshift({ id: o.id, t: o.finishedAt, pickup: o.pickup, dest: o.dest || o.destInCar, fare: o.fare, payment: o.payment, card: o.card, plate: car.plate, driver: car.driver, stars });
  profile.history = profile.history.slice(0, 30);
  saveProfile();
}

function saveProfile() { store.set('client-profile', profile); }

// ---------- căutare ----------
function openSearch(mode) {
  const popular = cityMap.raw.pois.filter(p => /Salina Turda$|Spitalul Municipal|^Kaufland$|Autogara|Primăria Municipiului Turda|^Lidl$|Grădina Zoologică/.test(p[0]))
    .filter((p, i, a) => a.findIndex(x => x[0] === p[0]) === i).slice(0, 6)
    .map(p => ({ label: p[0], sub: p[4] ? p[4] : CONFIG.city.name, lat: p[1], lon: p[2], type: p[3] }));
  const saved = profile.saved || {};
  const title = { pickup: 'De unde te luăm?', dest: 'Unde mergi?', 'save-home': 'Adresa de acasă', 'save-work': 'Adresa de la serviciu' }[mode];
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
      if (mode === 'pickup') html += `<button class="row" data-gps><span class="bubble accent">${icon('locate', { size: 22 })}</span><span class="grow"><div class="t">Locația mea</div><div class="s">Folosește GPS-ul telefonului</div></span></button>`;
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
    $$('[data-i]', list).forEach(b => b.onclick = () => {
      const r = current[+b.dataset.i];
      close();
      setPlace(mode, r.place || { lat: r.lat, lon: r.lon, label: r.type === 'strada' || r.type === 'adresa' ? r.label : r.label });
    });
    const gps = $('[data-gps]', list); if (gps) gps.onclick = () => { close(); useMyLocation(true); };
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
  render();
  if (pickupMk) { map.removeLayer(pickupMk); pickupMk = null; }
  if (destMk) { map.removeLayer(destMk); destMk = null; }
  route.clear();
  const startAt = mode === 'dest' && ui.dest ? ui.dest : ui.pickup;
  centerPin = h(`<div class="center-pin">${pinIcon(mode === 'dest' ? 'dest' : 'pickup', mode === 'dest' ? 'flag' : 'person').options.html}</div>`);
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
  // aduce punctul de start sub pin
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

function useMyLocation(explicit) {
  if (!navigator.geolocation) { toast('Telefonul nu permite localizarea.', 'warn'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const p = [pos.coords.latitude, pos.coords.longitude];
    const bb = cityMap.raw.bbox;
    if (p[0] < bb[0] || p[0] > bb[2] || p[1] < bb[1] || p[1] > bb[3]) {
      if (explicit) toast(`Ești în afara orașului ${CONFIG.city.name}. În demo folosim o adresă din ${CONFIG.city.name}.`, 'warn', 4500);
      fitTo([[ui.pickup.lat, ui.pickup.lon]]);
      return;
    }
    setPlace('pickup', { lat: p[0], lon: p[1], label: cityMap.reverse(p), kind: 'gps' });
    fitTo([p]);
  }, () => { if (explicit) toast('Nu am primit acces la locație. Poți alege adresa din căutare.', 'warn', 4000); fitTo([[ui.pickup.lat, ui.pickup.lon]]); }, { enableHighAccuracy: true, timeout: 8000 });
}

// ---------- programare ----------
function openSchedule() {
  const now = new Date();
  const ov = modal(`
    <div class="panel-head"><h2>Când vrei taxiul?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="seg mb"><button data-day="0" class="on">Azi</button><button data-day="1">Mâine</button></div>
    <div class="grid2">
      <label class="field"><span>Ora</span><select class="input" id="hh">${Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}</option>`).join('')}</select></label>
      <label class="field"><span>Minutul</span><select class="input" id="mm">${[0, 15, 30, 45].map(m => `<option value="${m}">${String(m).padStart(2, '0')}</option>`).join('')}</select></label>
    </div>
    <button class="btn primary block xl" id="schedOk">Programează</button>
  `);
  let day = 0;
  const t = new Date(now.getTime() + 45 * 60e3);
  $('#hh', ov).value = t.getHours(); $('#mm', ov).value = Math.floor(t.getMinutes() / 15) * 15 % 60;
  $$('[data-day]', ov).forEach(b => b.onclick = () => { day = +b.dataset.day; $$('[data-day]', ov).forEach(x => x.classList.toggle('on', x === b)); });
  $('#schedOk', ov).onclick = () => {
    const d = new Date(); d.setDate(d.getDate() + day); d.setHours(+$('#hh', ov).value, +$('#mm', ov).value, 0, 0);
    if (d.getTime() < Date.now() + 20 * 60e3) { toast('Alege o oră cu cel puțin 20 de minute de acum.', 'warn'); return; }
    ui.scheduledFor = d.getTime(); ov.close(); render();
  };
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
    <div class="secure-note">${icon('lock', { size: 20 })}<div>La finalul fiecărei curse plătite cu cardul, suma de pe taximetru se încasează automat și primești bonul în aplicație. <b>Demo:</b> nu se fac plăți reale – poți folosi 4242 4242 4242 4242.</div></div>
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

// ---------- apel, mesaje, distribuire, ajutor ----------
function callDriver() {
  const car = myCar(); if (!car) return;
  const ov = modal(`
    <div class="center" style="padding:10px 0 4px">
      <div class="car-card" style="justify-content:center;background:none"><div class="avatar" style="width:84px;height:84px;font-size:1.6em">${car.driver.split(' ').map(x => x[0]).join('')}</div></div>
      <h2 style="margin:0">${esc(car.driver)}</h2>
      <p class="muted" style="margin:6px 0 18px">Se apelează… Numărul tău rămâne privat (apel prin centrală).</p>
      <button class="btn danger block xl" data-close>${icon('phone')}Închide</button>
    </div>`);
  beep([440, .3, 440, .3]);
}

function openChat() {
  const o = currentOrder(); if (!o) return;
  const car = myCar(o);
  const quick = ['Ies acum', 'Sunt la intrarea principală', 'Te rog sună-mă', 'Am bagaje', 'Aștept în fața blocului'];
  const ov = modal(`
    <div class="panel-head"><h2>Mesaje cu ${esc(firstName(car ? car.driver : 'șoferul'))}</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="chat" id="chatList"></div>
    <div class="chips wrap mb">${quick.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="hstack"><input class="input" id="chatIn" placeholder="Scrie un mesaj…"><button class="icon-btn" style="background:var(--ink);color:var(--bg);width:56px;height:56px" id="chatSend" aria-label="Trimite">${icon('nav')}</button></div>
  `, { cls: 'chat-ov', onClose: () => { unsub(); } });
  const draw = () => {
    const msgs = bus.state.chats[o.id] || [];
    $('#chatList', ov).innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.from === 'client' ? 'me' : 'them'}">${esc(m.text)}<div class="tm">${fmtTime(m.t)}</div></div>`).join('') : '<p class="muted center">Scrie-i șoferului dacă ai nevoie de ceva.</p>';
    $('#chatList', ov).scrollTop = 1e6;
    ui.chatSeen = msgs.filter(m => m.from !== 'client').length;
  };
  const unsub = bus.on(draw);
  const send = text => { if (!text.trim()) return; bus.act('message', { orderId: o.id, from: 'client', text: text.trim() }); };
  $$('[data-q]', ov).forEach(b => b.onclick = () => send(b.dataset.q));
  $('#chatSend', ov).onclick = () => { send($('#chatIn', ov).value); $('#chatIn', ov).value = ''; };
  $('#chatIn', ov).onkeydown = e => { if (e.key === 'Enter') $('#chatSend', ov).click(); };
}

async function shareRide() {
  const o = currentOrder(); const car = myCar(o); if (!o || !car) return;
  const dest = o.dest || o.destInCar;
  const text = `Sunt într-un taxi ${CONFIG.company.name}: ${car.plate}, ${car.model} ${car.color}, șofer ${car.driver}.${dest ? ` Merg spre ${dest.label}` : ''}${o.status === 'in_cursa' ? `, ajung pe la ${fmtTime(Date.now() + etaSeconds(car) * 1000)}.` : '.'}`;
  try {
    if (navigator.share) { await navigator.share({ title: CONFIG.company.name, text }); return; }
  } catch { return; }
  try { await navigator.clipboard.writeText(text); toast('Detaliile cursei au fost copiate. Le poți lipi într-un mesaj.', 'ok', 3500, 'check'); }
  catch { modal(`<h2>Trimite familiei</h2><p>${esc(text)}</p><button class="btn block" data-close>OK</button>`); }
}

function openSos() {
  modal(`
    <div class="panel-head"><h2>Ai nevoie de ajutor?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="vstack">
      <a class="btn danger block xl" href="tel:112">${icon('phone')}Sună la 112</a>
      <a class="btn dark block xl" href="tel:${CONFIG.company.dispatchPhone.replace(/\s/g, '')}">${icon('headset')}Sună dispeceratul</a>
      <button class="btn ghost block xl" id="sosShare">${icon('share')}Trimite locația unui apropiat</button>
    </div>`);
  $('#sosShare').onclick = shareRide;
}
document.addEventListener('click', e => { if (e.target.closest('#sosBtn')) openSos(); });

function lostItem() {
  modal(`
    <div class="panel-head"><h2>Ai uitat ceva în taxi?</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted" style="margin-top:0">Dispeceratul știe exact în ce mașină ai fost și îl contactează pe șofer.</p>
    <a class="btn dark block xl" href="tel:${CONFIG.company.dispatchPhone.replace(/\s/g, '')}">${icon('headset')}Sună dispeceratul</a>`);
}

// ---------- meniu ----------
function openMenu() {
  const ov = modal(`
    <div class="menu-head"><div class="avatar">${esc((profile.name || '?').split(' ').map(x => x[0]).join('').slice(0, 2))}</div><div class="grow"><div style="font-weight:800;font-size:1.15em">${esc(profile.name)}</div><div class="muted">${esc(profile.phone)}</div></div><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="divider"></div>
    <button class="row" id="mHistory"><span class="bubble">${icon('history')}</span><span class="grow t">Cursele mele</span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mSaved"><span class="bubble">${icon('home')}</span><span class="grow t">Adrese salvate</span>${icon('chevron', { cls: 'muted' })}</button>
    <button class="row" id="mCard"><span class="bubble">${icon('card')}</span><span class="grow"><div class="t">Plată</div><div class="s">${profile.card ? `${esc(profile.card.brand)} •••• ${esc(profile.card.last4)}` : 'Niciun card salvat'}</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <div class="row"><span class="bubble">${icon('text')}</span><span class="grow"><div class="t">Text mare</div><div class="s">Litere și butoane mai mari</div></span><button class="toggle ${profile.big ? 'on' : ''}" id="mBig" aria-label="Text mare"></button></div>
    <a class="row" href="tel:${CONFIG.company.dispatchPhone.replace(/\s/g, '')}" style="text-decoration:none"><span class="bubble accent">${icon('headset')}</span><span class="grow"><div class="t">Sună dispeceratul</div><div class="s">${esc(CONFIG.company.dispatchPhone)} · non-stop</div></span></a>
    <button class="row" id="mOut"><span class="bubble">${icon('logout')}</span><span class="grow t">Ieși din cont</span></button>
    <p class="small muted center mt">${esc(CONFIG.company.name)} · ${esc(CONFIG.city.name)}</p>
  `);
  $('#mBig', ov).onclick = e => { profile.big = !profile.big; saveProfile(); applyTextSize(profile.big); e.currentTarget.classList.toggle('on', profile.big); ui.lastKey = ''; render(); };
  $('#mHistory', ov).onclick = () => { ov.close(); openHistory(); };
  $('#mSaved', ov).onclick = () => { ov.close(); openSaved(); };
  $('#mCard', ov).onclick = () => { ov.close(); openPayments(); };
  $('#mOut', ov).onclick = async () => { ov.close(); if (await confirmBox('Ieși din cont?', 'Datele tale rămân salvate pe telefon până intri din nou.', { yes: 'Ieși' })) { store.set('client-profile', null); location.reload(); } };
}

function openHistory() {
  const hist = profile.history || [];
  modal(`
    <div class="panel-head"><h2>Cursele mele</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    ${hist.length ? hist.map(x => `<div class="row"><span class="bubble">${icon(x.payment === 'card' ? 'card' : 'cash')}</span><span class="grow"><div class="t">${esc(x.dest ? x.dest.label : 'Cursă')}</div><div class="s">${new Date(x.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}, ${fmtTime(x.t)} · ${esc(x.plate || '')}${x.stars ? ` · ${'★'.repeat(x.stars)}` : ''}</div></span><b>${fmtMoney(x.fare)} lei</b></div>`).join('') : '<p class="muted center" style="padding:30px 0">Încă nu ai curse. Prima e la o atingere distanță!</p>'}
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
    profile = { name, phone, big, card: null, saved: { home: d.home, work: d.work }, history: [] };
    saveProfile(); ov.remove(); ui.lastKey = ''; render();
  };
}

let resizeT;
addEventListener('resize', () => {
  layoutAround();
  // când ecranul devine vizibil (ex. în simulator), reîncadrăm harta
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { map.invalidateSize(); const o = currentOrder(); const scr = screenFor(o); if (scr !== 'pickmap') updateMapForScreen(scr, o); }, 150);
});

// ---------- pornire ----------
bus.on(onState);
boot.done();
if (!profile) showOnboarding();
