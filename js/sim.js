// Motorul flotei: stări mașini, comenzi, alocare, stații, tarifare.
// Rulează într-un singur tab („liderul”); celelalte tab-uri primesc starea prin bus.js.
import { CONFIG } from '../config.js';
import { dist, cumulative, pointAt } from './geo.js';

export const STATUS = {
  liber: 'liber', spre: 'spre_client', cu: 'cu_client', pauza: 'pauza', offline: 'offline',
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

// ---------- utilitare comune (folosite și de interfețe) ----------
const cumCache = new Map();
export function moveCum(move) {
  let c = cumCache.get(move.id);
  if (!c) { c = cumulative(move.pts); cumCache.set(move.id, c); if (cumCache.size > 400) cumCache.delete(cumCache.keys().next().value); }
  return c;
}

export function carPos(car, now = Date.now()) {
  if (!car.move) return { p: [car.lat, car.lon], head: car.head || 0, moving: false };
  const m = car.move;
  const cum = moveCum(m);
  const d = m.d0 + m.speed * Math.max(0, now - m.t0) / 1000;
  const r = pointAt(m.pts, cum, d);
  return { p: r.p, head: r.head, moving: !r.done, done: !!r.done, i: r.i, remaining: Math.max(0, cum[cum.length - 1] - d), total: cum[cum.length - 1] };
}

export function remainingRoute(car, now = Date.now()) {
  if (!car.move) return [];
  const pos = carPos(car, now);
  return [pos.p, ...car.move.pts.slice(pos.i + 1)];
}

export function etaSeconds(car, now = Date.now()) {
  if (!car.move) return 0;
  const pos = carPos(car, now);
  return pos.remaining / car.move.speed;
}

export function isNight(date = new Date()) {
  const h = date.getHours();
  return h >= 22 || h < 6;
}

export function perKm(date) {
  return isNight(date) ? CONFIG.tariff.perKmNight : CONFIG.tariff.perKmDay;
}

export function estimateFare(meters, date = new Date()) {
  const T = CONFIG.tariff;
  const km = meters / 1000;
  const price = Math.max(T.minFare, T.start + km * perKm(date));
  const minutes = Math.max(2, Math.round(meters / (CONFIG.demo.avgSpeedKmh / 3.6) / 60 + 1));
  return {
    km: Math.round(km * 10) / 10,
    minutes,
    price: Math.round(price * 100) / 100,
    low: Math.floor(price * 0.95),
    high: Math.ceil(price * 1.1),
  };
}

export function fmtLei(v) {
  return v.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei';
}

export function queueInfo(state, car) {
  if (!car.station || car.status !== STATUS.liber) return null;
  const q = state.cars.filter(c => c.station === car.station && c.status === STATUS.liber && !c.move)
    .sort((a, b) => a.queuedAt - b.queuedAt);
  return { pos: q.findIndex(c => c.id === car.id) + 1, total: q.length, station: CONFIG.stations.find(s => s.id === car.station) };
}

export function stationQueue(state, stationId) {
  return state.cars.filter(c => c.station === stationId && c.status === STATUS.liber && !c.move)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

// Categorie de afișare pe hartă
export function carCategory(car) {
  if (car.status === STATUS.offline) return 'offline';
  if (car.status === STATUS.pauza) return 'pauza';
  if (car.status === STATUS.cu) return 'cu_client';
  if (car.status === STATUS.spre) return 'spre_client';
  return car.station && !car.move ? 'liber_statie' : 'liber_drum';
}

export const CATEGORY_LABEL = {
  liber_statie: 'Liber în stație',
  liber_drum: 'Liber pe drum',
  spre_client: 'Merge la client',
  cu_client: 'Cu client',
  pauza: 'Pauză',
  offline: 'Deconectat',
};

export const ORDER_LABEL = {
  programata: 'Programată',
  cautare: 'Caută șofer',
  oferita: 'Trimisă la șofer',
  acceptata: 'Șofer pe drum',
  sosit: 'Șoferul a ajuns',
  in_cursa: 'În cursă',
  finalizata: 'Finalizată',
  anulata: 'Anulată',
};

// ---------- Simulatorul ----------
export class Sim {
  constructor(map) {
    this.map = map;
    this.nextBg = Date.now() + 8000;
  }

  fresh() {
    const now = Date.now();
    const stations = CONFIG.stations;
    const state = {
      v: 1, created: now, speedMul: 2, bgOrders: true, humanPriority: true, humanBg: true,
      cars: [], orders: [], chats: {}, alerts: [], clients: {}, orderSeq: 1040,
    };
    CONFIG.fleet.forEach((f, i) => {
      const st = stations[i % stations.length];
      const car = {
        id: 'car' + (i + 1), plate: f.plate, model: f.model, color: f.color, driver: f.driver,
        rating: f.rating, years: f.years, big: !!f.big, human: !!f.human,
        status: f.human ? STATUS.offline : STATUS.liber, station: st.id, queuedAt: now - rnd(0, 1800e3),
        lat: st.lat, lon: st.lon, head: 0, move: null, orderId: null, offerId: null,
        speedFactor: rnd(0.88, 1.12), earnings: { cash: 0, card: 0, rides: 0 }, shiftStart: now - rnd(1, 5) * 3600e3,
        wait: 0,
      };
      if (!f.human) {
        // istoric demo pentru ziua de azi
        car.earnings.rides = Math.floor(rnd(3, 11));
        car.earnings.cash = Math.round(car.earnings.rides * rnd(9, 14)) ;
        car.earnings.card = Math.round(car.earnings.rides * rnd(5, 9));
      }
      state.cars.push(car);
    });
    // O parte din mașini pornesc deja ocupate / pe drum, ca orașul să pară viu
    const sims = state.cars.filter(c => !c.human);
    sims.slice(0, 4).forEach(car => this._bgOrder(state, now, car, true));
    sims.slice(4, 6).forEach(car => this._bgOrder(state, now, car, false));
    sims.slice(6, 8).forEach(car => this._cruise(state, car, now));
    const sp = sims[8]; if (sp) { sp.status = STATUS.pauza; }
    // client demo cunoscut în dispecerat
    const dc = CONFIG.demoClient;
    state.clients[dc.phone.replace(/\s/g, '')] = { name: dc.name, phone: dc.phone, rides: 14, last: dc.home };
    state.clients['0722987654'] = { name: 'Ioan Bălan', phone: '0722 987 654', rides: 37, last: { address: 'Strada Clujului 21', lat: 46.5782, lon: 23.7801 } };
    state.clients['0755111222'] = { name: 'Elena Pop', phone: '0755 111 222', rides: 5, last: { address: 'Calea Victoriei 33', lat: 46.5602, lon: 23.81516 } };
    return state;
  }

  speed(state, car) {
    return (CONFIG.demo.avgSpeedKmh / 3.6) * car.speedFactor * state.speedMul;
  }

  _setMove(state, car, to, kind, now) {
    const from = carPos(car, now).p;
    const r = this.map.route(from, to);
    car.move = { id: uid('m'), pts: r.pts, t0: now, d0: 0, speed: this.speed(state, car), kind };
    car.station = null;
    return r.meters;
  }

  _stopAt(car, now) {
    const pos = carPos(car, now);
    car.lat = pos.p[0]; car.lon = pos.p[1]; car.head = pos.head;
    car.move = null;
  }

  nearestStation(p) {
    let best = CONFIG.stations[0], bd = Infinity;
    for (const s of CONFIG.stations) { const d = dist(p, [s.lat, s.lon]); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  _goStation(state, car, now, stationId) {
    const pos = carPos(car, now).p;
    const st = stationId ? CONFIG.stations.find(s => s.id === stationId) : this.nearestStation(pos);
    car.targetStation = st.id;
    this._setMove(state, car, [st.lat, st.lon], 'station', now);
  }

  _cruise(state, car, now) {
    const p = this.map.randomPoint();
    this._setMove(state, car, [p.lat, p.lon], 'cruise', now);
  }

  setSpeed(state, mul, now = Date.now()) {
    for (const car of state.cars) {
      if (!car.move) continue;
      const pos = carPos(car, now);
      car.move.d0 = pos.total - pos.remaining;
      car.move.t0 = now;
      car.move.speed = car.move.speed / state.speedMul * mul;
    }
    for (const o of state.orders) this._refreshEta(state, o, now, mul);
    state.speedMul = mul;
  }

  _refreshEta(state, o, now, mul = state.speedMul) {
    const car = state.cars.find(c => c.id === o.carId);
    if (!car || !car.move) return;
    const pos = carPos(car, now);
    const sp = car.move.speed / state.speedMul * mul;
    if (o.status === 'acceptata') o.etaPickupAt = now + pos.remaining / sp * 1000;
    if (o.status === 'in_cursa') o.etaDropAt = now + pos.remaining / sp * 1000;
  }

  // ---------- comenzi ----------
  createOrder(state, p, now = Date.now()) {
    const order = {
      id: p.id || uid('o'),
      code: ++state.orderSeq,
      createdAt: now,
      source: p.source || 'app',
      client: p.client || { name: 'Client', phone: '' },
      pickup: p.pickup,
      dest: p.dest || null,
      note: p.note || '',
      options: p.options || {},
      payment: p.payment || 'cash',
      card: p.card || null,
      estimate: p.estimate || null,
      scheduledFor: p.scheduledFor || null,
      status: p.scheduledFor && p.scheduledFor - now > 15 * 60e3 ? 'programata' : 'cautare',
      carId: null, offer: null, refused: [], forceCar: p.forceCar || null,
      timeline: [{ t: now, s: 'creata' }],
    };
    if (!order.estimate && order.dest) {
      const r = this.map.route([order.pickup.lat, order.pickup.lon], [order.dest.lat, order.dest.lon]);
      order.estimate = estimateFare(r.meters);
    }
    state.orders.push(order);
    if (order.source !== 'fundal') {
      const key = (order.client.phone || '').replace(/\s/g, '');
      if (key) {
        const c = state.clients[key] || { name: order.client.name, phone: order.client.phone, rides: 0 };
        c.name = order.client.name || c.name; c.last = { address: order.pickup.label, lat: order.pickup.lat, lon: order.pickup.lon };
        state.clients[key] = c;
      }
    }
    if (order.status === 'cautare') this.dispatch(state, order, now);
    return order;
  }

  _bgOrder(state, now, forcedCar = null, inRide = false) {
    const a = this.map.randomPoint();
    let b = this.map.randomPoint();
    for (let k = 0; k < 4 && dist([a.lat, a.lon], [b.lat, b.lon]) < 900; k++) b = this.map.randomPoint();
    const names = ['Andrei', 'Ioana', 'Gabriel', 'Raluca', 'Bogdan', 'Cristina', 'Adrian', 'Lavinia', 'Ovidiu', 'Simona', 'Tudor', 'Diana', 'Petru', 'Camelia', 'Iulian', 'Monica'];
    const o = this.createOrder(state, {
      source: 'fundal',
      client: { name: pick(names), phone: '07' + Math.floor(rnd(20, 89)) + ' ' + Math.floor(rnd(100, 999)) + ' ' + Math.floor(rnd(100, 999)) },
      pickup: { lat: a.lat, lon: a.lon, label: a.label },
      dest: Math.random() < 0.85 ? { lat: b.lat, lon: b.lon, label: b.label } : null,
      payment: Math.random() < 0.4 ? 'card' : 'cash',
      forceCar: forcedCar ? forcedCar.id : null,
    }, now);
    if (forcedCar) {
      this.accept(state, o, forcedCar, now);
      if (inRide) {
        // mașina e deja cu clientul
        this._stopAt(forcedCar, now);
        forcedCar.lat = a.lat; forcedCar.lon = a.lon;
        this.pickedUp(state, o, now);
      }
    }
    return o;
  }

  candidates(state, order) {
    return state.cars.filter(c => c.status === STATUS.liber && !c.offerId && !order.refused.includes(c.id)
      && !(order.source === 'fundal' && c.human && !state.humanBg));
  }

  dispatch(state, order, now = Date.now()) {
    if (order.status !== 'cautare') return;
    let cands = this.candidates(state, order);
    if (order.forceCar) {
      const fc = state.cars.find(c => c.id === order.forceCar);
      if (fc && fc.status === STATUS.liber && !fc.offerId) cands = [fc];
      else { order.forceCar = null; }
    }
    if (!cands.length) {
      if (now - order.createdAt > 40e3 && !order.noDriverAlert && order.source !== 'fundal') {
        order.noDriverAlert = true;
        this.alert(state, 'fara_sofer', `Comanda #${order.code}: nicio mașină liberă momentan`, { orderId: order.id }, now);
      }
      if (order.source === 'fundal' && now - order.createdAt > 60e3) this.cancel(state, order, 'sistem', 'Fără șofer', now);
      return;
    }
    const P = [order.pickup.lat, order.pickup.lon];
    if (order.options && order.options.bigTrunk) {
      const big = cands.filter(c => c.big);
      if (big.length) cands = big;
    }
    let chosen = null;
    // 1) Comenzile reale din demo merg întâi la șoferul din aplicație, dacă e liber
    if (!order.forceCar && order.source !== 'fundal' && state.humanPriority) {
      chosen = cands.find(c => c.human) || null;
    }
    // 1b) Comenzile de fundal ajung din când în când și la șoferul demo
    if (!chosen && order.source === 'fundal' && state.humanBg) {
      const h = cands.find(c => c.human);
      if (h && Math.random() < 0.45 && dist(carPos(h, now).p, P) < 2500) chosen = h;
    }
    // 2) Ordinea din stație: dacă clientul e lângă o stație cu mașini, primul la rând
    if (!chosen) {
      const st = this.nearestStation(P);
      if (dist(P, [st.lat, st.lon]) < 650) {
        const q = stationQueue(state, st.id).filter(c => cands.includes(c));
        if (q.length) chosen = q[0];
      }
    }
    // 3) Cea mai apropiată mașină liberă
    if (!chosen) {
      let bd = Infinity;
      for (const c of cands) {
        if (order.source === 'fundal' && c.human) continue;
        const d = dist(carPos(c, now).p, P);
        if (d < bd) { bd = d; chosen = c; }
      }
      if (!chosen) chosen = cands[0];
    }
    this.offer(state, order, chosen, now);
  }

  offer(state, order, car, now = Date.now()) {
    const humanSec = CONFIG.demo.offerSecondsHuman;
    order.status = 'oferita';
    const toPickup = this.map.route(carPos(car, now).p, [order.pickup.lat, order.pickup.lon]).meters;
    order.offer = {
      carId: car.id, at: now,
      until: now + (car.human ? humanSec * 1000 : 9000),
      autoAt: car.human ? null : now + rnd(1500, 4000),
      meters: Math.round(toPickup),
      minutes: Math.max(1, Math.round(toPickup / (CONFIG.demo.avgSpeedKmh / 3.6) / 60)),
    };
    car.offerId = order.id;
    order.timeline.push({ t: now, s: 'oferita', car: car.id });
  }

  refuse(state, order, car, now = Date.now(), timeout = false) {
    if (!order.offer || order.offer.carId !== car.id) return;
    car.offerId = null;
    order.refused.push(car.id);
    order.offer = null;
    order.forceCar = null;
    order.status = 'cautare';
    order.timeline.push({ t: now, s: timeout ? 'fara_raspuns' : 'refuzata', car: car.id });
    if (car.human && order.source !== 'fundal') {
      this.alert(state, 'refuz', `${car.driver} ${timeout ? 'nu a răspuns la' : 'a refuzat'} comanda #${order.code}. Se caută alt șofer.`, { orderId: order.id, carId: car.id }, now);
    }
    this.dispatch(state, order, now);
  }

  accept(state, order, car, now = Date.now()) {
    car.offerId = null;
    order.offer = null;
    order.status = 'acceptata';
    order.carId = car.id;
    order.acceptedAt = now;
    car.status = STATUS.spre;
    car.orderId = order.id;
    car.station = null; car.queuedAt = null; car.atPickup = false;
    const m = this._setMove(state, car, [order.pickup.lat, order.pickup.lon], 'pickup', now);
    order.pickupMeters = Math.round(m);
    order.etaPickupAt = now + m / car.move.speed * 1000;
    order.timeline.push({ t: now, s: 'acceptata', car: car.id });
  }

  arrived(state, order, now = Date.now()) {
    if (!['acceptata'].includes(order.status)) return;
    const car = state.cars.find(c => c.id === order.carId);
    if (car) this._stopAt(car, now);
    order.status = 'sosit';
    order.arrivedAt = now;
    order.timeline.push({ t: now, s: 'sosit' });
    if (car && !car.human) car.wait = now + rnd(10000, 28000) / state.speedMul;
  }

  pickedUp(state, order, now = Date.now()) {
    const car = state.cars.find(c => c.id === order.carId);
    if (!car) return;
    order.status = 'in_cursa';
    order.startedAt = now;
    order.waitMinutes = order.arrivedAt ? Math.max(0, (now - order.arrivedAt) / 60000 * state.speedMul - CONFIG.tariff.freeWaitMin) : 0;
    car.status = STATUS.cu;
    this._stopAt(car, now);
    let dest = order.dest;
    if (!dest) {
      // destinația se spune în mașină – demo: alegem o adresă
      const p = this.map.randomPoint();
      dest = { lat: p.lat, lon: p.lon, label: p.label, toldInCar: true };
      order.destInCar = dest;
    }
    const m = this._setMove(state, car, [dest.lat, dest.lon], 'ride', now);
    order.rideMeters = Math.round(m);
    order.etaDropAt = now + m / car.move.speed * 1000;
    order.timeline.push({ t: now, s: 'in_cursa' });
  }

  computeFare(order, now = Date.now()) {
    const T = CONFIG.tariff;
    const km = (order.rideMeters || 0) / 1000;
    const wait = Math.max(0, order.waitMinutes || 0) * T.perMinWait;
    const fare = Math.max(T.minFare, T.start + km * perKm(new Date(order.startedAt || now)) * rnd(0.98, 1.05) + wait);
    return Math.round(fare * 100) / 100;
  }

  finish(state, order, now = Date.now(), fare) {
    if (order.status !== 'in_cursa') return;
    const car = state.cars.find(c => c.id === order.carId);
    order.fare = Math.round((fare ?? this.computeFare(order, now)) * 100) / 100;
    order.status = 'finalizata';
    order.finishedAt = now;
    order.paid = order.payment === 'card'; // cardul se încasează automat
    order.timeline.push({ t: now, s: 'finalizata', fare: order.fare });
    if (order.payment === 'card') order.timeline.push({ t: now, s: 'card_incasat' });
    if (car) {
      this._stopAt(car, now);
      car.earnings.rides++;
      car.earnings[order.payment === 'card' ? 'card' : 'cash'] += order.fare;
      car.status = STATUS.liber;
      car.orderId = null;
      car.atPickup = false; car.atDest = false;
      // șoferul din aplicație alege singur unde merge (buton „Mergi la stație”)
      if (!car.human) this._goStation(state, car, now);
    }
    const key = (order.client.phone || '').replace(/\s/g, '');
    if (state.clients[key] && order.source !== 'fundal') state.clients[key].rides++;
  }

  collectCash(state, order, now = Date.now()) {
    if (order.status === 'finalizata') { order.paid = true; order.timeline.push({ t: now, s: 'cash_incasat' }); }
  }

  cancel(state, order, by, reason, now = Date.now()) {
    if (['finalizata', 'anulata'].includes(order.status)) return;
    const car = state.cars.find(c => c.id === order.carId || (order.offer && c.id === order.offer.carId));
    if (car) {
      if (car.offerId === order.id) car.offerId = null;
      if (car.orderId === order.id) {
        car.orderId = null; car.status = STATUS.liber; car.atPickup = false; car.atDest = false;
        if (car.human) this._stopAt(car, now); else this._goStation(state, car, now);
      }
    }
    order.status = 'anulata'; order.cancelledBy = by; order.cancelReason = reason || ''; order.offer = null;
    order.timeline.push({ t: now, s: 'anulata', by });
    if (by === 'client' && order.source !== 'fundal') this.alert(state, 'anulare', `Clientul a anulat comanda #${order.code}`, { orderId: order.id }, now, true);
    if (by === 'sofer') this.alert(state, 'anulare', `Șoferul a anulat comanda #${order.code}: ${reason}`, { orderId: order.id }, now);
  }

  alert(state, kind, text, extra = {}, now = Date.now(), info = false) {
    state.alerts.push({ id: uid('a'), t: now, kind, text, ack: false, info, ...extra });
    if (state.alerts.length > 40) state.alerts.splice(0, state.alerts.length - 40);
  }

  message(state, orderId, from, text, now = Date.now()) {
    (state.chats[orderId] ||= []).push({ from, text, t: now });
  }

  // ---------- tick ----------
  tick(state, now = Date.now()) {
    let changed = false;
    // programate
    for (const o of state.orders) {
      if (o.status === 'programata' && o.scheduledFor - now < 15 * 60e3) { o.status = 'cautare'; changed = true; }
    }
    // oferte
    for (const o of state.orders) {
      if (o.status === 'cautare' && !o.offer) { this.dispatch(state, o, now); changed = true; continue; }
      if (o.status === 'oferita' && o.offer) {
        const car = state.cars.find(c => c.id === o.offer.carId);
        if (!car) { o.status = 'cautare'; o.offer = null; continue; }
        if (o.offer.autoAt && now >= o.offer.autoAt) { this.accept(state, o, car, now); changed = true; }
        else if (now >= o.offer.until) { this.refuse(state, o, car, now, true); changed = true; }
      }
    }
    // mașini
    for (const car of state.cars) {
      if (car.move) {
        const pos = carPos(car, now);
        if (!pos.done) continue;
        changed = true;
        const kind = car.move.kind;
        const order = state.orders.find(o => o.id === car.orderId);
        this._stopAt(car, now);
        if (kind === 'pickup' && order) {
          if (car.human) { car.atPickup = true; }
          else this.arrived(state, order, now);
        } else if (kind === 'ride' && order) {
          if (car.human) { car.atDest = true; }
          else this.finish(state, order, now);
        } else if (kind === 'station') {
          car.station = car.targetStation || this.nearestStation([car.lat, car.lon]).id;
          car.queuedAt = now;
        } else if (kind === 'cruise') {
          if (car.status === STATUS.liber && !car.human) this._goStation(state, car, now);
        }
      } else if (!car.human) {
        // așteptare client (șoferi simulați)
        const order = state.orders.find(o => o.id === car.orderId);
        if (order && order.status === 'sosit' && car.wait && now >= car.wait) { car.wait = 0; this.pickedUp(state, order, now); changed = true; }
        // pauze ocazionale
        if (car.status === STATUS.pauza && Math.random() < 0.0015 * state.speedMul) { car.status = STATUS.liber; car.queuedAt = now; changed = true; }
        else if (car.status === STATUS.liber && car.station && Math.random() < 0.00015 * state.speedMul) { car.status = STATUS.pauza; changed = true; }
        // echilibrare stații
        else if (car.status === STATUS.liber && car.station && !car.offerId && Math.random() < 0.0004 * state.speedMul) {
          const q = stationQueue(state, car.station);
          if (q.length >= 3 && q[q.length - 1].id === car.id) {
            const target = CONFIG.stations.slice().sort((a, b) => stationQueue(state, a.id).length - stationQueue(state, b.id).length)[0];
            if (target.id !== car.station) { this._goStation(state, car, now, target.id); changed = true; }
          }
        }
      }
    }
    // comenzi de fundal
    if (state.bgOrders && now >= this.nextBg) {
      const free = state.cars.filter(c => c.status === STATUS.liber && !c.human).length;
      if (free > 2) { this._bgOrder(state, now); changed = true; }
      const rate = CONFIG.demo.backgroundOrdersPerMinute * state.speedMul;
      this.nextBg = now + (-Math.log(1 - Math.random()) * 60000 / rate);
    }
    // curățenie
    const keep = [];
    for (const o of state.orders) {
      const old = ['finalizata', 'anulata'].includes(o.status) && now - (o.finishedAt || o.timeline[o.timeline.length - 1].t) > (o.source === 'fundal' ? 6 : 240) * 60e3;
      if (!old) keep.push(o); else changed = true;
    }
    if (keep.length !== state.orders.length) state.orders = keep;
    if (state.orders.length > 160) state.orders = state.orders.slice(-160);
    return changed;
  }

  // ---------- acțiuni venite din interfețe ----------
  apply(state, action, p, now = Date.now()) {
    const order = p && p.orderId ? state.orders.find(o => o.id === p.orderId) : null;
    const car = p && p.carId ? state.cars.find(c => c.id === p.carId) : null;
    switch (action) {
      case 'createOrder': this.createOrder(state, p, now); break;
      case 'cancelOrder': if (order) this.cancel(state, order, p.by || 'client', p.reason, now); break;
      case 'rateOrder': if (order) { order.rating = p.stars; order.ratingTags = p.tags || []; order.ratingNote = p.note || ''; } break;
      case 'message': if (order) this.message(state, order.id, p.from, p.text, now); break;

      case 'driverLogin': if (car) {
        car.status = STATUS.liber; car.shiftStart = now;
        if (!car.move) { const st = this.nearestStation([car.lat, car.lon]); if (dist([car.lat, car.lon], [st.lat, st.lon]) < 120) { car.station = st.id; car.queuedAt = now; } }
      } break;
      case 'driverLogout': if (car && !car.orderId) { car.status = STATUS.offline; car.station = null; if (car.offerId) { const o = state.orders.find(x => x.id === car.offerId); if (o) this.refuse(state, o, car, now); } } break;
      case 'driverStatus': if (car && !car.orderId) {
        car.status = p.status;
        if (p.status === STATUS.liber) {
          const st = this.nearestStation(carPos(car, now).p);
          if (!car.move && dist([car.lat, car.lon], [st.lat, st.lon]) < 150) { car.station = st.id; car.queuedAt = now; }
        } else if (car.offerId) { const o = state.orders.find(x => x.id === car.offerId); if (o) this.refuse(state, o, car, now); }
      } break;
      case 'goStation': if (car && car.status === STATUS.liber && !car.orderId) this._goStation(state, car, now, p.stationId); break;
      case 'accept': if (order && car && order.offer && order.offer.carId === car.id) this.accept(state, order, car, now); break;
      case 'refuse': if (order && car) this.refuse(state, order, car, now); break;
      case 'arrived': if (order) this.arrived(state, order, now); break;
      case 'pickedUp': if (order) this.pickedUp(state, order, now); break;
      case 'finish': if (order) this.finish(state, order, now, p.fare); break;
      case 'collectCash': if (order) this.collectCash(state, order, now); break;
      case 'driverDrop': if (order && order.carId) {
        const c = state.cars.find(x => x.id === order.carId);
        if (c) { c.orderId = null; c.status = STATUS.liber; c.atPickup = false; this._stopAt(c, now); order.refused.push(c.id); }
        order.carId = null; order.status = 'cautare'; order.offer = null; order.etaPickupAt = null;
        order.timeline.push({ t: now, s: 'realocata' });
        this.alert(state, 'refuz', `${c ? c.driver : 'Șoferul'} nu poate ajunge la comanda #${order.code}. Se caută alt șofer.`, { orderId: order.id }, now);
        this.dispatch(state, order, now);
      } break;
      case 'noShow': if (order) this.cancel(state, order, 'sofer', 'Clientul nu s-a prezentat', now); break;
      case 'sos': if (car) this.alert(state, 'sos', `SOS de la ${car.driver} (${car.plate})`, { carId: car.id, lat: carPos(car, now).p[0], lon: carPos(car, now).p[1] }, now); break;

      case 'assign': if (order && car) {
        if (order.offer) { const oc = state.cars.find(c => c.id === order.offer.carId); if (oc) oc.offerId = null; order.offer = null; }
        if (['cautare', 'oferita', 'programata'].includes(order.status) && car.status === STATUS.liber && !car.offerId) {
          order.status = 'cautare'; order.forceCar = car.id; order.refused = order.refused.filter(id => id !== car.id);
          this.dispatch(state, order, now);
        }
      } break;
      case 'ackAlert': { const a = state.alerts.find(x => x.id === p.id); if (a) a.ack = true; } break;
      case 'ackAll': state.alerts.forEach(a => a.ack = true); break;
      case 'setSpeed': this.setSpeed(state, p.mul, now); break;
      case 'setFlag': state[p.key] = !!p.value; break;
      case 'reset': return 'reset';
    }
    return null;
  }
}
