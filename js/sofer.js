// Aplicația ȘOFER – gândită pentru oricine: butoane mari, puțin text, un singur pas pe ecran.
import { CONFIG } from '../config.js';
import { CityMap, dist } from './geo.js';
import { connect } from './bus.js';
import { carPos, carCategory, CATEGORY_LABEL, queueInfo, stationQueue, etaSeconds, remainingRoute, isNight, STATUS, perKm } from './sim.js';
import { createMap, FleetLayer, pinIcon, RouteLine, cssVar } from './mapview.js';
import { icon } from './icons.js';
import { $, $$, h, esc, toast, modal, confirmBox, fmtTime, fmtMin, fmtKm, fmtClock, fmtMoney, firstName, beep, vibrate, speak, store, applyTextSize, applyTheme, navLinks, loadingScreen, unlockAudio } from './ui.js';

const L = window.L;
const T = CONFIG.tariff;
const boot = loadingScreen('Pregătim harta pentru tură…');
unlockAudio();

const settings = Object.assign({ theme: 'auto', big: false, voice: true, nav: 'waze' }, store.get('driver-settings', {}));
const saveSettings = () => store.set('driver-settings', settings);
const darkNow = () => settings.theme === 'dark' || (settings.theme === 'auto' && isNight());
applyTheme(darkNow());
applyTextSize(settings.big);
document.title = 'Șofer · ' + CONFIG.company.name;

const humanFleetIdx = Math.max(0, CONFIG.fleet.findIndex(f => f.human));
const ME = 'car' + (humanFleetIdx + 1);
let session = store.get('driver-session', null);

let cityMap, bus, map, fleet, route, jobMk;
const ui = { lastKey: '', follow: true, offerId: null, finishing: null, chatSeen: {}, lastMsgT: 0, lastStatus: null };

try { cityMap = await CityMap.load(); } catch (e) { boot.fail('Nu am putut încărca harta. Verifică internetul.'); throw e; }

const app = $('#app');
app.innerHTML = `
  <div class="statusbar" id="sb">
    <button class="icon-btn" id="menuBtn" aria-label="Meniu">${icon('menu', { size: 26 })}</button>
    <div class="grow"><div class="title" id="sbTitle">—</div><div class="sub" id="sbSub"></div></div>
    <button class="sos-btn" id="sosBtn" aria-label="SOS – ține apăsat 2 secunde"><div class="fill"></div><span>SOS</span></button>
  </div>
  <div class="mapwrap"><div id="map" class="map"></div><button class="icon-btn recenter" id="recenter" aria-label="Centrează pe mine" hidden>${icon('locate')}</button></div>
  <div class="dpanel" id="panel"></div>
  <div class="demo-badge" style="top:auto;bottom:calc(8px + var(--safe-b));left:10px;right:auto">DEMO · x<span id="spd">1</span></div>
`;
map = createMap($('#map'), { dark: darkNow(), cityMap, zoom: 15 });
route = new RouteLine(map);
bus = await connect(cityMap, { role: 'sofer' });
window.taxiDemo = bus;
fleet = new FleetLayer(map, { me: ME, onFrame: frame, tag: c => c.id === ME ? 'TU' : '' });
map.on('dragstart', () => { ui.follow = false; $('#recenter').hidden = false; });
$('#recenter').onclick = () => { ui.follow = true; $('#recenter').hidden = true; followMe(true); };
$('#menuBtn').onclick = openMenu;
setupSos();


// ---------- stare ----------
function me() { return bus && bus.state && bus.state.cars.find(c => c.id === ME); }
function myOrder() { const c = me(); return c && c.orderId ? bus.state.orders.find(o => o.id === c.orderId) : null; }
function myOffer() { return bus.state && bus.state.orders.find(o => o.status === 'oferita' && o.offer && o.offer.carId === ME); }

function onState(state) {
  if (!state) return;
  $('#spd').textContent = state.speedMul;
  fleet.update(state);
  const car = me();
  if (session && car && car.status === STATUS.offline && !ui.loggingOut) {
    // sesiune salvată, dar mașina e deconectată (ex. stare nouă) – reconectăm
    bus.act('driverLogin', { carId: ME });
  }
  // ofertă nouă
  const off = myOffer();
  if (off && ui.offerId !== off.id) showOffer(off);
  if (!off && ui.offerId) closeOffer();
  // mesaje noi de la client
  const o = myOrder();
  if (o) {
    const msgs = (state.chats[o.id] || []).filter(m => m.from !== 'sofer');
    const last = msgs[msgs.length - 1];
    if (last && last.t > ui.lastMsgT && !document.querySelector('.chat-ov')) {
      ui.lastMsgT = last.t;
      toast(`<b>Clientul:</b> ${esc(last.text)}`, '', 6000, 'message'); beep([990, .1, 990, .1]); vibrate([80, 60, 80]);
      if (settings.voice) speak('Mesaj de la client. ' + last.text);
    }
  }
  if (o && ui.lastStatus && o.status !== ui.lastStatus && o.status === 'anulata') { toast('Clientul a anulat comanda.', 'bad', 5000); vibrate(300); }
  ui.lastStatus = o ? o.status : null;
  // clientul a anulat cât timp mergeam spre el
  if (ui.trackOrder && !o) {
    const prev = state.orders.find(x => x.id === ui.trackOrder);
    if (prev && prev.status === 'anulata' && prev.cancelledBy === 'client') { toast('Clientul a anulat comanda. Ești din nou liber.', 'warn', 6000); beep([600, .2, 400, .3]); vibrate(300); if (settings.voice) speak('Clientul a anulat comanda.'); }
    ui.trackOrder = null;
  }
  if (o) ui.trackOrder = o.id;
  render();
}

// ---------- randare ----------
function render() {
  const car = me(); if (!car || !session) return;
  const o = myOrder();
  const fin = ui.finishing ? bus.state.orders.find(x => x.id === ui.finishing) : null;
  let scr;
  if (fin) scr = 'paid';
  else if (!o) scr = car.status === STATUS.pauza ? 'pause' : 'idle';
  else scr = { acceptata: 'pickup', sosit: 'waiting', in_cursa: 'ride' }[o.status] || 'idle';

  // banda de sus
  const cat = carCategory(car);
  const sb = $('#sb');
  sb.className = 'statusbar ' + (scr === 'paid' ? 'liber_drum' : cat);
  const qi = queueInfo(bus.state, car);
  const titles = {
    idle: 'LIBER',
    pause: 'PAUZĂ', pickup: 'MERGI LA CLIENT', waiting: 'LA ADRESĂ · AȘTEPȚI', ride: 'CU CLIENT', paid: 'CURSĂ TERMINATĂ',
  };
  $('#sbTitle').textContent = titles[scr];
  $('#sbSub').textContent = qi && scr === 'idle' ? `Stația ${qi.station.name} · ${qi.pos === 1 ? 'ești primul la rând' : `ești al ${qi.pos}-lea la rând`}` : `${car.plate} · ${car.driver}`;

  const key = scr + '|' + (o ? o.id + o.status : '') + '|' + (fin ? fin.id + fin.paid + fin.status + fin.fare : '') + '|' + car.status + '|' + (car.station || '') + '|' + (qi ? qi.pos + '/' + qi.total : '') + '|' + (car.move ? car.move.kind : '') + '|' + document.documentElement.dataset.theme;
  if (key !== ui.lastKey) {
    ui.lastKey = key;
    $('#panel').innerHTML = PANELS[scr](car, o || fin);
    BIND[scr] && BIND[scr](car, o || fin);
    updateMap(scr, car, o);
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
  if (force && o) {
    const target = o.status === 'in_cursa' ? (o.dest || o.destInCar) : o.pickup;
    if (target) {
      const b = L.latLngBounds([p, [target.lat, target.lon]]);
      if (ui.follow) map.fitBounds(b, { padding: [60, 60], maxZoom: 17 });
      return;
    }
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
  // date care se schimbă continuu
  $$('[data-eta]').forEach(el => { el.textContent = car.move ? fmtMin(etaSeconds(car)) : '—'; });
  $$('[data-dist]').forEach(el => { el.textContent = car.move ? fmtKm(carPos(car).remaining) : '0 m'; });
  const near = o && o.status === 'acceptata' && (car.atPickup || dist(carPos(car).p, [o.pickup.lat, o.pickup.lon]) < 200);
  const arr = $('#arrivedBtn');
  if (arr) {
    arr.classList.toggle('wait', !near); arr.classList.toggle('go', near); arr.classList.toggle('pulse', near);
    arr.innerHTML = near ? `${icon('check', { size: 30, stroke: 2.8 })}AM AJUNS` : `Ajungi în <b style="margin:0 6px" data-eta>${car.move ? fmtMin(etaSeconds(car)) : '—'}</b> · AM AJUNS`;
    if (near && !ui.nearAnnounced) { ui.nearAnnounced = o.id; beep([700, .1, 1050, .15]); vibrate(120); if (settings.voice) speak('Ai ajuns la adresă. Apasă Am ajuns, ca să-l anunțăm pe client.'); }
  }
  if (o && o.status === 'sosit' && o.arrivedAt) {
    const sec = (Date.now() - o.arrivedAt) / 1000 * bus.state.speedMul;
    const t = $('#waitTimer'); if (t) t.textContent = fmtClock(sec);
    const fw = $('#freeWait'); if (fw) fw.innerHTML = sec < T.freeWaitMin * 60 ? `Gratuit încă ${fmtClock(T.freeWaitMin * 60 - sec)}` : `<b style="color:var(--to)">Se taxează așteptarea · ${fmtMoney(T.perMinWait)} lei/min</b>`;
    const ns = $('#noShowBtn'); if (ns) ns.hidden = sec < 5 * 60;
  }
  const atDest = o && o.status === 'in_cursa' && car.atDest;
  const fb = $('#finishBtn');
  if (fb) { fb.classList.toggle('pulse', !!atDest); }
  if (atDest && ui.destAnnounced !== o.id) { ui.destAnnounced = o.id; beep([700, .1, 1050, .15]); vibrate(120); if (settings.voice) speak('Ai ajuns la destinație.'); }
  if (o) {
    const unread = (bus.state.chats[o.id] || []).filter(m => m.from !== 'sofer').length - (ui.chatSeen[o.id] || 0);
    $$('[data-unread]').forEach(el => { el.hidden = unread <= 0; el.textContent = unread; });
  }
  // statistici azi
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
function optionTags(o) {
  const map2 = { bigTrunk: ['luggage', 'Portbagaj mare'], pet: ['paw', 'Animal'], childSeat: ['baby', 'Scaun copil'], help: ['help', 'Ajutor la urcare'] };
  return Object.entries(o.options || {}).filter(([, v]) => v).map(([k]) => `<span class="pill" style="font-size:.85em;padding:6px 10px">${icon(map2[k][0], { size: 18 })}${map2[k][1]}</span>`).join('');
}
function payTag(o) {
  return o.payment === 'card'
    ? `<span class="pay-tag card">${icon('card', { size: 20 })}Card · se încasează automat</span>`
    : `<span class="pay-tag cash">${icon('cash', { size: 20 })}Plată cash</span>`;
}

const PANELS = {
  idle(car) {
    const qi = queueInfo(bus.state, car);
    const p = carPos(car).p;
    const nearest = CONFIG.stations.map(s => ({ s, d: dist(p, [s.lat, s.lon]) })).sort((a, b) => a.d - b.d)[0];
    const goingTo = car.move && car.move.kind === 'station' ? CONFIG.stations.find(s => s.id === car.targetStation) : null;
    const pre = bus.state.orders.filter(x => x.status === 'programata').length;
    return `
      <div class="state-toggle">
        <button class="on free" data-st="liber">${icon('check', { size: 28, stroke: 3 })}LIBER</button>
        <button data-st="pauza">${icon('pause', { size: 26 })}PAUZĂ</button>
      </div>
      ${qi ? `
        <div class="queue-card"><div class="pos">${qi.pos}<small>${qi.pos === 1 ? 'PRIMUL' : 'LA RÂND'}</small></div><div class="grow"><div class="t">Stația ${esc(qi.station.name)}</div><div class="muted small">${qi.total} ${qi.total === 1 ? 'mașină' : 'mașini'} în stație · ${esc(qi.station.hint)}</div></div></div>`
      : goingTo ? `
        <div class="queue-card"><div class="pos" style="background:var(--free)">${icon('nav', { size: 28 })}</div><div class="grow"><div class="t">Mergi spre Stația ${esc(goingTo.name)}</div><div class="muted small">Ajungi în <span data-eta>—</span> · intri automat la rând</div></div></div>`
      : `
        <div class="queue-card off"><div class="pos" style="background:var(--pause)">${icon('stand', { size: 30 })}</div><div class="grow"><div class="t">Nu ești într-o stație</div><div class="muted small">Primești comenzi după distanță</div></div></div>
        <button class="btn go block xl mt" data-gostation="${nearest.s.id}">${icon('nav')}Mergi la Stația ${esc(nearest.s.name)} · ${fmtKm(nearest.d)}</button>`}
      <div class="today" id="todayStats"></div>
      <div class="grid2 mt">
        <button class="btn block" id="stationsBtn">${icon('stand')}Stații</button>
        <button class="btn block" id="preBtn">${icon('calendar')}Precomenzi${pre ? ` (${pre})` : ''}</button>
      </div>
    `;
  },

  pause(car) {
    return `
      <div class="state-toggle">
        <button data-st="liber">${icon('check', { size: 28, stroke: 3 })}LIBER</button>
        <button class="on pause" data-st="pauza">${icon('pause', { size: 26 })}PAUZĂ</button>
      </div>
      <p class="center muted" style="margin:16px 0 4px;font-weight:650">Ești în pauză – nu primești comenzi.<br>Apasă <b>LIBER</b> când vrei să lucrezi din nou.</p>
      <div class="today" id="todayStats"></div>
    `;
  },

  pickup(car, o) {
    return `
      <div class="hstack between"><span class="muted" style="font-weight:800">Clientul: ${esc(o.client.name)}</span><span class="pill st-spre_client"><span class="dot"></span><span data-dist>—</span></span></div>
      <div class="job-addr">${esc(o.pickup.label)}</div>
      ${o.note ? `<div class="job-note">${icon('message', { size: 22 })}<div>„${esc(o.note)}”</div></div>` : ''}
      <div class="job-meta">${payTag(o)}${optionTags(o)}</div>
      <div class="tool-row">
        <button class="tool nav" data-nav>${icon('nav', { size: 26 })}Navighează</button>
        <button class="tool" data-call>${icon('phone', { size: 26 })}Sună</button>
        <button class="tool" data-chat>${icon('message', { size: 26 })}Mesaj<span class="badge" data-unread hidden></span></button>
      </div>
      <button class="btn step block wait" id="arrivedBtn">AM AJUNS</button>
      <button class="linkbtn" id="cancelJob" style="background:none;border:0;color:var(--muted);font-weight:700;min-height:48px;width:100%;text-decoration:underline">Nu pot ajunge – anunță dispeceratul</button>
    `;
  },

  waiting(car, o) {
    return `
      <div class="hstack between"><div><div class="muted" style="font-weight:800">Aștepți clientul de</div><div class="big-timer" id="waitTimer">0:00</div></div>
      <div style="text-align:right"><div class="muted small" style="font-weight:700">${esc(o.client.name)}</div><div class="small" id="freeWait"></div></div></div>
      <div class="job-meta" style="margin-top:12px">${payTag(o)}${optionTags(o)}</div>
      <div class="tool-row" style="grid-template-columns:1fr 1fr">
        <button class="tool" data-call>${icon('phone', { size: 26 })}Sună clientul</button>
        <button class="tool" data-chat>${icon('message', { size: 26 })}Mesaj<span class="badge" data-unread hidden></span></button>
      </div>
      <button class="btn step go block" id="pickedBtn">${icon('person', { size: 30 })}CLIENTUL A URCAT</button>
      <button class="btn danger-soft block mt" id="noShowBtn" hidden>Clientul nu a venit</button>
    `;
  },

  ride(car, o) {
    const d = o.dest || o.destInCar;
    return `
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
    `;
  },

  paid(car, o) {
    if (o.payment === 'card') {
      return `
        <div class="center" style="padding:6px 0">
          <div class="bubble" style="margin:0 auto 10px;width:72px;height:72px;border-radius:22px;background:var(--free);color:#fff">${icon('check', { size: 40, stroke: 3 })}</div>
          <div class="muted" style="font-weight:800">Încasat automat de pe card</div>
          <div class="amount" style="font-size:2.6em">${fmtMoney(o.fare ?? ui.finishFare)} lei</div>
          <div class="muted">${esc(o.card ? `${o.card.brand} •••• ${o.card.last4}` : '')} · bonul a ajuns la client</div>
        </div>
        <button class="btn go step block mt" id="doneBtn">GATA · DEVIN LIBER</button>`;
    }
    return `
      <div class="center" style="padding:6px 0">
        <div class="bubble accent" style="margin:0 auto 10px;width:72px;height:72px;border-radius:22px">${icon('cash', { size: 40 })}</div>
        <div class="muted" style="font-weight:800">Ia de la client, cash:</div>
        <div class="amount" style="font-size:2.8em">${fmtMoney(o.fare ?? ui.finishFare)} lei</div>
        <div class="muted small">Nu uita bonul de la taximetru.</div>
      </div>
      <button class="btn go step block mt" id="cashBtn">${icon('check', { size: 30, stroke: 2.8 })}AM ÎNCASAT</button>`;
  },
};

const BIND = {
  idle(car) { bindState(); bindIdle(); },
  pause() { bindState(); },
  pickup(car, o) {
    bindJob(o);
    $('#arrivedBtn').onclick = () => {
      const near = car.atPickup || dist(carPos(me()).p, [o.pickup.lat, o.pickup.lon]) < 200;
      if (!near) { toast('Încă nu ești la adresă. Butonul se activează când ajungi.', 'warn', 3000); return; }
      bus.act('arrived', { orderId: o.id }); beep([880, .12]);
      toast('Clientul a fost anunțat că ai ajuns.', 'ok', 3000, 'check');
    };
    $('#cancelJob').onclick = async () => {
      if (await confirmBox('Renunți la comandă?', 'Comanda se trimite imediat altui șofer. Folosește doar dacă nu poți ajunge (pană, accident, blocaj).', { yes: 'Da, renunț', no: 'Nu', danger: true })) {
        bus.act('driverDrop', { orderId: o.id });
        toast('Comanda a fost trimisă altui șofer.', '', 3000);
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
  ride(car, o) {
    bindJob(o);
    $('#finishBtn').onclick = () => openMeter(o);
  },
  paid(car, o) {
    const done = () => { ui.finishing = null; ui.lastKey = ''; render(); suggestStation(); };
    const d = $('#doneBtn'); if (d) d.onclick = done;
    const c = $('#cashBtn'); if (c) c.onclick = () => { bus.act('collectCash', { orderId: o.id }); toast(`Încasat ${fmtMoney(o.fare ?? ui.finishFare)} lei cash`, 'ok', 2500, 'check'); done(); };
  },
};

function bindState() {
  $$('[data-st]').forEach(b => b.onclick = () => {
    const s = b.dataset.st;
    bus.act('driverStatus', { carId: ME, status: s === 'liber' ? STATUS.liber : STATUS.pauza });
    beep([s === 'liber' ? 990 : 520, .12]);
  });
}
function bindIdle() {
  $$('[data-gostation]').forEach(b => b.onclick = () => { bus.act('goStation', { carId: ME, stationId: b.dataset.gostation }); ui.follow = true; });
  $('#stationsBtn').onclick = openStations;
  $('#preBtn').onclick = openPreorders;
}
function bindJob(o) {
  $$('[data-nav]').forEach(b => b.onclick = () => openNav(o));
  $$('[data-call]').forEach(b => b.onclick = () => callClient(o));
  $$('[data-chat]').forEach(b => b.onclick = () => openChat(o));
}

function suggestStation() {
  const car = me(); if (!car || car.station || car.move) return;
  const p = carPos(car).p;
  const s = CONFIG.stations.map(s => ({ s, d: dist(p, [s.lat, s.lon]), n: stationQueue(bus.state, s.id).length })).sort((a, b) => a.d - b.d)[0];
  toast(`Cea mai apropiată stație: ${esc(s.s.name)} (${fmtKm(s.d)}, ${s.n} mașini).`, '', 4000, 'stand');
}

// ---------- oferta ----------
let offerEl, offerTimer, offerSound;
function showOffer(o) {
  closeOffer();
  ui.offerId = o.id;
  const total = (o.offer.until - o.offer.at) / 1000;
  const d = o.dest;
  offerEl = h(`<div class="offer" role="alertdialog" aria-label="Comandă nouă">
    <div class="offer-head">
      <div class="t">COMANDĂ NOUĂ${o.source === 'telefon' ? '<div class="small muted" style="font-weight:700;letter-spacing:0">prin dispecerat</div>' : ''}</div>
      <div class="ring"><svg width="74" height="74"><circle cx="37" cy="37" r="32" stroke="var(--line)" stroke-width="7" fill="none"/><circle id="ringArc" cx="37" cy="37" r="32" stroke="var(--free)" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="201" stroke-dashoffset="0"/></svg><div class="n" id="ringN">${Math.round(total)}</div></div>
    </div>
    <div class="offer-body">
      <div class="from">
        <div class="lbl">Iei clientul de la</div>
        <div class="addr">${esc(o.pickup.label)}</div>
        <div class="dist">${fmtKm(o.offer.meters)} · ~${o.offer.minutes} min de tine</div>
      </div>
      <div class="to">
        <div class="bubble accent">${icon('flag')}</div>
        <div class="grow"><div class="muted small" style="font-weight:800">DESTINAȚIE</div><div class="addr">${d ? esc(d.label) : 'O spune clientul în mașină'}</div></div>
        ${o.estimate ? `<div class="money">${o.estimate.low}–${o.estimate.high}<span class="small" style="font-weight:700"> lei</span></div>` : ''}
      </div>
      <div class="job-meta">${payTag(o)}${optionTags(o)}</div>
      ${o.note ? `<div class="job-note">${icon('message', { size: 22 })}<div>„${esc(o.note)}”</div></div>` : ''}
    </div>
    <div class="offer-actions">
      <button class="btn" id="refuseBtn">Refuz</button>
      <button class="btn go" id="acceptBtn">${icon('check', { size: 34, stroke: 3 })}ACCEPT</button>
    </div>
  </div>`);
  document.body.append(offerEl);
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
  if (settings.voice) setTimeout(() => speak(`Comandă nouă. ${o.pickup.label}. ${o.offer.minutes} minute până la client.${o.payment === 'card' ? ' Plată cu cardul.' : ''}`), 600);
}
function closeOffer() {
  clearInterval(offerTimer); clearInterval(offerSound);
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

// ---------- navigare, apel, mesaje ----------
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

function callClient(o) {
  modal(`
    <div class="center" style="padding:10px 0 4px">
      <div class="bubble accent" style="margin:0 auto 12px;width:84px;height:84px;border-radius:50%">${icon('user', { size: 40 })}</div>
      <h2 style="margin:0">${esc(o.client.name)}</h2>
      <p class="muted" style="margin:6px 0 18px">Se apelează prin centrală… numărul clientului rămâne ascuns.</p>
      <button class="btn danger block xl" data-close>${icon('phone')}Închide</button>
    </div>`);
  beep([440, .3, 440, .3]);
}

function openChat(o) {
  const quick = ['Am ajuns, vă aștept', 'Ajung în 2 minute', 'Sunt în fața blocului', 'Nu găsesc adresa, vă rog sunați-mă', 'Sunt în trafic, întârzii puțin'];
  const ov = modal(`
    <div class="panel-head"><h2>Mesaje · ${esc(firstName(o.client.name))}</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <div class="chat" id="chatList" style="display:flex;flex-direction:column;gap:8px;max-height:30vh;overflow-y:auto;margin-bottom:12px"></div>
    <p class="muted small" style="margin:0 0 8px;font-weight:700">Atinge un mesaj ca să-l trimiți:</p>
    <div class="vstack">${quick.map(q => `<button class="btn block" style="justify-content:flex-start" data-q="${esc(q)}">${icon('message', { size: 20 })}${esc(q)}</button>`).join('')}</div>
  `, { cls: 'chat-ov', onClose: () => unsub() });
  const draw = () => {
    const msgs = bus.state.chats[o.id] || [];
    $('#chatList', ov).innerHTML = msgs.map(m => `<div style="align-self:${m.from === 'sofer' ? 'flex-end' : 'flex-start'};max-width:85%;padding:10px 14px;border-radius:16px;font-weight:650;background:${m.from === 'sofer' ? 'var(--ink);color:var(--bg)' : 'var(--surface-2)'}">${esc(m.text)}<div style="font-size:.7em;opacity:.6">${fmtTime(m.t)}</div></div>`).join('') || '<p class="muted center" style="margin:0">Niciun mesaj încă.</p>';
    $('#chatList', ov).scrollTop = 1e6;
    ui.chatSeen[o.id] = msgs.filter(m => m.from !== 'sofer').length;
  };
  const unsub = bus.on(draw);
  $$('[data-q]', ov).forEach(b => b.onclick = () => { bus.act('message', { orderId: o.id, from: 'sofer', text: b.dataset.q }); toast('Trimis', 'ok', 1500, 'check'); });
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
  const pre = bus.state.orders.filter(x => x.status === 'programata').sort((a, b) => a.scheduledFor - b.scheduledFor);
  modal(`
    <div class="panel-head"><h2>Precomenzi</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
    <p class="muted small" style="margin-top:-6px">Le primești automat cu 15 minute înainte, după ordinea din stație.</p>
    ${pre.length ? pre.map(o => `<div class="row"><span class="bubble accent" style="font-weight:900;font-size:.85em">${fmtTime(o.scheduledFor)}</span><span class="grow"><div class="t">${esc(o.pickup.label)}</div><div class="s">${o.dest ? 'spre ' + esc(o.dest.label) : 'destinație în mașină'}</div></span></div>`).join('') : '<p class="muted center" style="padding:24px 0">Nu sunt precomenzi momentan.</p>'}
  `);
}

// ---------- meniu ----------
function openMenu() {
  const car = me();
  const today = bus.state.orders.filter(o => o.carId === ME && o.status === 'finalizata').sort((a, b) => b.finishedAt - a.finishedAt);
  const ov = modal(`
    <div class="menu-head" style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <div class="bubble accent" style="width:60px;height:60px;border-radius:50%;font-weight:900;font-size:1.2em">${esc(car.driver.split(' ').map(x => x[0]).join(''))}</div>
      <div class="grow"><div style="font-weight:850;font-size:1.15em">${esc(car.driver)}</div><div class="muted">${esc(car.plate)} · ${esc(car.model)}</div></div>
      <button class="icon-btn flat" data-close>${icon('close')}</button>
    </div>
    <div class="grid2 mb">
      <div class="stat"><div class="k">Cash azi</div><div class="v">${fmtMoney(car.earnings.cash)} lei</div></div>
      <div class="stat"><div class="k">Card azi</div><div class="v">${fmtMoney(car.earnings.card)} lei</div></div>
    </div>
    <button class="row" id="mHist"><span class="bubble">${icon('history')}</span><span class="grow"><div class="t">Cursele de azi</div><div class="s">${today.length} în aplicație</div></span>${icon('chevron', { cls: 'muted' })}</button>
    <div class="row"><span class="bubble">${icon('moon')}</span><span class="grow"><div class="t">Mod noapte</div><div class="s">Ecran întunecat, nu te orbește noaptea</div></span>
      <select class="input" id="mTheme" style="width:auto;min-height:48px"><option value="auto">Automat</option><option value="dark">Pornit</option><option value="light">Oprit</option></select></div>
    <div class="row"><span class="bubble">${icon('volume')}</span><span class="grow"><div class="t">Citește comenzile cu voce</div><div class="s">Nu mai trebuie să te uiți la telefon</div></span><button class="toggle ${settings.voice ? 'on' : ''}" id="mVoice" aria-label="Voce"></button></div>
    <div class="row"><span class="bubble">${icon('text')}</span><span class="grow"><div class="t">Text mare</div></span><button class="toggle ${settings.big ? 'on' : ''}" id="mBig" aria-label="Text mare"></button></div>
    <div class="row"><span class="bubble">${icon('nav')}</span><span class="grow"><div class="t">Navigație</div></span>
      <select class="input" id="mNav" style="width:auto;min-height:48px"><option value="ask">Întreabă</option><option value="waze">Waze</option><option value="google">Google Maps</option></select></div>
    <a class="row" href="tel:${CONFIG.company.dispatchPhone.replace(/\s/g, '')}" style="text-decoration:none"><span class="bubble accent">${icon('headset')}</span><span class="grow"><div class="t">Sună dispeceratul</div><div class="s">${esc(CONFIG.company.dispatchPhone)}</div></span></a>
    <button class="row" id="mOut"><span class="bubble">${icon('logout')}</span><span class="grow t">Închide tura</span></button>
  `);
  $('#mTheme', ov).value = settings.theme;
  $('#mNav', ov).value = settings.navAsk === false ? settings.nav : 'ask';
  $('#mTheme', ov).onchange = e => { settings.theme = e.target.value; saveSettings(); applyTheme(darkNow()); map.setDark(darkNow()); ui.lastKey = ''; render(); };
  $('#mNav', ov).onchange = e => { if (e.target.value === 'ask') settings.navAsk = true; else { settings.nav = e.target.value; settings.navAsk = false; } saveSettings(); };
  $('#mVoice', ov).onclick = e => { settings.voice = !settings.voice; saveSettings(); e.currentTarget.classList.toggle('on', settings.voice); if (settings.voice) speak('Comenzile vor fi citite cu voce.'); };
  $('#mBig', ov).onclick = e => { settings.big = !settings.big; saveSettings(); applyTextSize(settings.big); e.currentTarget.classList.toggle('on', settings.big); };
  $('#mHist', ov).onclick = () => {
    ov.close();
    modal(`<div class="panel-head"><h2>Cursele de azi</h2><button class="icon-btn flat" data-close>${icon('close')}</button></div>
      ${today.length ? today.map(o => `<div class="row"><span class="bubble">${icon(o.payment === 'card' ? 'card' : 'cash')}</span><span class="grow"><div class="t">${esc((o.dest || o.destInCar || {}).label || o.pickup.label)}</div><div class="s">${fmtTime(o.finishedAt)} · de la ${esc(o.pickup.label)}${o.rating ? ` · ${'★'.repeat(o.rating)}` : ''}</div></span><b>${fmtMoney(o.fare)}</b></div>`).join('') : '<p class="muted center" style="padding:24px 0">Nicio cursă prin aplicație azi.</p>'}`);
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
      <h2 style="margin:0 0 6px">Dispeceratul a fost alertat</h2><p class="muted" style="margin:0 0 16px">Locația ta a fost trimisă. Rămâi calm, vei fi contactat imediat.</p>
      <a class="btn danger block xl" href="tel:112">${icon('phone')}Sună la 112</a><button class="btn ghost block mt" data-close>Închide</button></div>`);
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
      <div class="bubble accent" style="width:56px;height:56px;border-radius:50%;font-weight:900">${esc(f.driver.split(' ').map(x => x[0]).join(''))}</div>
      <div class="grow"><div style="font-weight:850">${esc(f.driver)}</div><div class="muted small">${esc(f.model)} · ${esc(f.plate)}</div></div>
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

// ---------- pornire ----------
bus.on(onState);
boot.done();
if (!session) showLogin();

// tema de noapte automată
setInterval(() => { const d = darkNow(); if ((document.documentElement.dataset.theme === 'dark') !== d) { applyTheme(d); map.setDark(d); ui.lastKey = ''; render(); } }, 60000);
