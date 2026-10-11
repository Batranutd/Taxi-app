// Motorul flotei: stări mașini, comenzi, alocare, stații, tarifare, apeluri, siguranță.
// Rulează într-un singur tab („liderul”); celelalte tab-uri primesc starea prin bus.js.
// În producție, aceeași logică rulează pe server.
import { CONFIG } from '../config.js';
import { dist, cumulative, pointAt, decimate } from './geo.js';

export const STATUS = {
  liber: 'liber', spre: 'spre_client', cu: 'cu_client', pauza: 'pauza', offline: 'offline',
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
export const phoneKey = ph => (ph || '').replace(/\D/g, '');

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

export function estimateFare(meters, date = new Date(), slow = 1) {
  const T = CONFIG.tariff;
  const km = meters / 1000;
  const price = Math.max(T.minFare, T.start + km * perKm(date));
  const minutes = Math.max(2, Math.round(meters * (slow || 1) / (CONFIG.demo.avgSpeedKmh / 3.6) / 60 + 1));
  return {
    km: Math.round(km * 10) / 10,
    minutes,
    price: Math.round(price * 100) / 100,
    low: Math.max(T.minFare, Math.floor(price * 0.95)),
    high: Math.ceil(price * 1.1),
  };
}

export function queueInfo(state, car) {
  if (!car.station || car.status !== STATUS.liber) return null;
  const q = stationQueue(state, car.station);
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
// Categoria simplificată pentru culori: liber / spre / cu / pauza
export const colorCat = car => { const c = carCategory(car); return c.startsWith('liber') ? 'liber' : c; };

export const CATEGORY_LABEL = {
  liber_statie: 'Liber · în stație',
  liber_drum: 'Liber',
  liber: 'Liber',
  spre_client: 'Merge la o comandă',
  cu_client: 'Cu client',
  pauza: 'În pauză',
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

// Opțiuni speciale: ce a cerut clientul și ce are mașina
export const reqOptions = (opts = {}) => CONFIG.options.map(o => o.key).filter(k => opts[k]);
export function carHas(car, key) { return key === 'bigTrunk' ? !!car.caps.big : !!car.caps[key]; }
export function optionLabel(key) { return (CONFIG.options.find(o => o.key === key) || {}).short || key; }
export function carCapsList(car) { return CONFIG.options.filter(o => carHas(car, o.key)); }

export function pauseLeft(car, now = Date.now()) {
  if (car.status !== STATUS.pauza || !car.pauseUntil) return null;
  return Math.max(0, (car.pauseUntil - now) / 1000);
}

export function avgRating(reviews, base = 4.8, weight = 25) {
  if (!reviews || !reviews.length) return base;
  const sum = reviews.reduce((a, r) => a + r.stars, 0);
  return Math.round((base * weight + sum) / (weight + reviews.length) * 10) / 10;
}

export function clientInfo(state, client) {
  const c = state.clients[phoneKey(client && client.phone)] || null;
  return {
    name: (client && client.name) || (c && c.name) || 'Client',
    phone: (client && client.phone) || (c && c.phone) || '',
    photo: (client && client.photo) || (c && c.photo) || null,
    rides: c ? c.rides : 0,
    reviews: c && c.reviews ? c.reviews : [],
    rating: c && c.reviews && c.reviews.length ? avgRating(c.reviews, 4.8, 3) : null,
  };
}

export const initials = n => (n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

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
      v: 1, created: now, speedMul: 2, bgOrders: true, humanPriority: true, humanBg: false,
      cars: [], orders: [], chats: {}, alerts: [], clients: {}, orderSeq: 1040,
      calls: [], driverMsgs: [],
    };
    const pool = CONFIG.demoReviews.driver;
    const who = ['Maria', 'Andrei', 'Ioana', 'Elena', 'Bogdan', 'Raluca', 'Mihai', 'Diana', 'Paul', 'Corina'];
    CONFIG.fleet.forEach((f, i) => {
      const st = stations[i % stations.length];
      const reviews = Array.from({ length: 3 + (i % 3) }, (_, k) => {
        const r = pool[(i * 3 + k * 2) % pool.length];
        return { stars: r[0], text: r[1], by: who[(i + k) % who.length], t: now - (k + 1) * rnd(0.6, 2.5) * 86400e3 };
      });
      const car = {
        id: 'car' + (i + 1), cs: f.cs ?? parseInt((f.plate.match(/\d+/) || ['0'])[0], 10),
        plate: f.plate, model: f.model, color: f.color, driver: f.driver,
        rating: f.rating, baseRating: f.rating, years: f.years, human: !!f.human, photo: null, reviews,
        caps: { big: !!f.big, childSeat: !!f.childSeat, pet: !!f.pet, help: !!f.help },
        status: f.human ? STATUS.offline : STATUS.liber, station: st.id, queuedAt: now - rnd(0, 1800e3),
        lat: st.lat, lon: st.lon, head: rnd(0, 360), move: null, orderId: null, offerId: null,
        speedFactor: rnd(0.88, 1.12), earnings: { cash: 0, card: 0, tips: 0, rides: 0 }, shiftStart: now - rnd(1, 5) * 3600e3,
        wait: 0, pauseUntil: null, recording: false,
      };
      if (!f.human) {
        car.earnings.rides = Math.floor(rnd(3, 11));
        car.earnings.cash = Math.round(car.earnings.rides * rnd(9, 14));
        car.earnings.card = Math.round(car.earnings.rides * rnd(5, 9));
      }
      state.cars.push(car);
    });
    // O parte din mașini pornesc deja ocupate / pe drum, ca orașul să pară viu
    const sims = state.cars.filter(c => !c.human);
    sims.slice(0, 4).forEach(car => this._bgOrder(state, now, car, true));
    sims.slice(4, 6).forEach(car => this._bgOrder(state, now, car, false));
    sims.slice(6, 8).forEach(car => this._cruise(state, car, now));
    const sp = sims[8]; if (sp) { sp.status = STATUS.pauza; sp.pauseUntil = now + 6 * 60e3; }
    // clienți cunoscuți (dispecerat + recenzii date de șoferi)
    const dc = CONFIG.demoClient;
    const cr = CONFIG.demoReviews.client;
    const mk = (name, phone, rides, last, n) => ({
      name, phone, rides, last, photo: null,
      reviews: Array.from({ length: n }, (_, k) => ({ stars: cr[k % cr.length][0], text: cr[k % cr.length][1], by: pick(CONFIG.fleet).driver, t: now - (k + 1) * rnd(2, 9) * 86400e3 })),
      history: [],
    });
    state.clients[phoneKey(dc.phone)] = mk(dc.name, dc.phone, 14, dc.home && { address: dc.home.address, lat: dc.home.lat, lon: dc.home.lon }, 3);
    state.clients['0722987654'] = mk('Ioan Bălan', '0722 987 654', 37, { address: 'Strada Clujului 21', lat: 46.5782, lon: 23.7801 }, 4);
    state.clients['0722987654'].history = [{ pickup: { label: 'Strada Clujului 21', lat: 46.5782, lon: 23.7801 }, dest: { label: 'Spitalul Municipal Turda', lat: 46.57892, lon: 23.77694 }, t: now - 86400e3 * 2 }];
    state.clients['0755111222'] = mk('Elena Pop', '0755 111 222', 5, { address: 'Calea Victoriei 33', lat: 46.5602, lon: 23.81516 }, 1);
    return state;
  }

  speed(state, car, slow = 1) {
    return (CONFIG.demo.avgSpeedKmh / 3.6) * car.speedFactor * state.speedMul / Math.max(1, slow);
  }

  _setMove(state, car, to, kind, now) {
    const from = carPos(car, now).p;
    const r = this.map.route(from, to);
    car.move = { id: uid('m'), pts: r.pts, t0: now, d0: 0, speed: this.speed(state, car, r.slow), kind, slow: r.slow };
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
    state.speedMul = mul;
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
      priority: !!p.priority,
      payment: p.payment || 'cash',
      card: p.card || null,
      estimate: p.estimate || null,
      scheduledFor: p.scheduledFor || null,
      status: 'cautare',
      carId: null, offer: null, refused: [], forceCar: p.forceCar || null,
      requestCar: p.requestCar || null, request: null, reservedBy: null,
      track: [], plannedRoute: null,
      timeline: [{ t: now, s: 'creata' }],
    };
    if (order.dest) {
      const r = this.map.route([order.pickup.lat, order.pickup.lon], [order.dest.lat, order.dest.lon]);
      if (!order.estimate) order.estimate = estimateFare(r.meters, new Date(order.scheduledFor || now), r.slow);
      if (order.source !== 'fundal') order.plannedRoute = decimate(r.pts, 140);
    }
    if (order.scheduledFor) {
      // o cerere către un anume șofer (ex. în pauză) pornește exact la ora aleasă; restul cu 15 min înainte
      order.activateAt = order.requestCar ? order.scheduledFor : order.scheduledFor - 15 * 60e3;
      if (order.activateAt > now + 5000) order.status = 'programata';
      if (!order.requestCar && order.scheduledFor - now > 20 * 60e3) order.autoReserveAt = now + rnd(40, 90) * 1000;
    }
    if (order.requestCar) {
      const rc = state.cars.find(c => c.id === order.requestCar);
      if (order.status === 'programata' && rc) {
        order.request = { carId: rc.id, status: 'pending', at: now, respondAt: rc.human ? null : now + rnd(3000, 7000) };
        order.timeline.push({ t: now, s: 'cerere', car: rc.id });
      } else if (rc) order.forceCar = rc.id;
    }
    state.orders.push(order);
    if (order.source !== 'fundal') {
      const key = phoneKey(order.client.phone);
      if (key) {
        const c = state.clients[key] || { name: order.client.name, phone: order.client.phone, rides: 0, reviews: [], history: [] };
        c.name = order.client.name || c.name;
        if (order.client.photo) c.photo = order.client.photo;
        c.last = { address: order.pickup.label, lat: order.pickup.lat, lon: order.pickup.lon };
        c.history = [{ pickup: order.pickup, dest: order.dest, t: now }, ...(c.history || [])].slice(0, 5);
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
    const opts = {};
    if (Math.random() < 0.12) opts[pick(CONFIG.options).key] = true;
    const o = this.createOrder(state, {
      source: 'fundal',
      client: { name: pick(names), phone: '07' + Math.floor(rnd(20, 89)) + ' ' + Math.floor(rnd(100, 999)) + ' ' + Math.floor(rnd(100, 999)) },
      pickup: { lat: a.lat, lon: a.lon, label: a.label },
      dest: Math.random() < 0.85 ? { lat: b.lat, lon: b.lon, label: b.label } : null,
      payment: Math.random() < 0.4 ? 'card' : 'cash',
      options: opts,
      forceCar: forcedCar ? forcedCar.id : null,
    }, now);
    if (forcedCar) {
      this.accept(state, o, forcedCar, now);
      if (inRide) {
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
    // Opțiuni speciale: mașinile dotate sunt alertate primele
    const req = reqOptions(order.options);
    if (req.length && !order.forceCar) {
      const full = cands.filter(c => req.every(k => carHas(c, k)));
      if (full.length) { cands = full; order.optMatch = 'complet'; }
      else {
        order.optMatch = 'partial';
        if (!order.optAlert && order.source !== 'fundal') {
          order.optAlert = true;
          this.alert(state, 'optiuni', `Comanda #${order.code}: nicio mașină liberă cu ${req.map(optionLabel).join(', ').toLowerCase()}. Trimisă la cea mai apropiată.`, { orderId: order.id }, now);
        }
      }
    }
    let chosen = null;
    // 1) Comenzile reale din demo merg întâi la șoferul din aplicație, dacă e liber și potrivit
    if (!order.forceCar && order.source !== 'fundal' && state.humanPriority) chosen = cands.find(c => c.human) || null;
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
    const r = this.map.route(carPos(car, now).p, [order.pickup.lat, order.pickup.lon]);
    order.offer = {
      carId: car.id, at: now,
      until: now + (car.human ? humanSec * 1000 : 9000),
      autoAt: car.human ? null : now + rnd(1500, 4000),
      meters: Math.round(r.meters),
      minutes: Math.max(1, Math.round(r.meters * r.slow / (CONFIG.demo.avgSpeedKmh / 3.6) / 60)),
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
      this.alert(state, 'refuz', `${car.driver} (${car.cs}) ${timeout ? 'nu a răspuns la' : 'a refuzat'} comanda #${order.code}. Se caută alt șofer.`, { orderId: order.id, carId: car.id }, now);
    }
    this.dispatch(state, order, now);
  }

  accept(state, order, car, now = Date.now()) {
    if (car.offerId === order.id) car.offerId = null;
    order.offer = null;
    order.status = 'acceptata';
    order.carId = car.id;
    order.acceptedAt = now;
    car.status = STATUS.spre;
    car.orderId = order.id;
    car.pauseUntil = null; car.pauseOver = false;
    car.station = null; car.queuedAt = null; car.atPickup = false; car.atDest = false;
    const m = this._setMove(state, car, [order.pickup.lat, order.pickup.lon], 'pickup', now);
    order.pickupMeters = Math.round(m);
    order.timeline.push({ t: now, s: 'acceptata', car: car.id });
  }

  arrived(state, order, now = Date.now()) {
    if (order.status !== 'acceptata') return;
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
    order.rideStartIdx = order.track.length;
    order.waitMinutes = order.arrivedAt ? Math.max(0, (now - order.arrivedAt) / 60000 * state.speedMul - CONFIG.tariff.freeWaitMin) : 0;
    car.status = STATUS.cu;
    this._stopAt(car, now);
    let dest = order.dest;
    if (!dest) {
      const p = this.map.randomPoint();
      dest = { lat: p.lat, lon: p.lon, label: p.label, toldInCar: true };
      order.destInCar = dest;
    }
    const m = this._setMove(state, car, [dest.lat, dest.lon], 'ride', now);
    if (order.source !== 'fundal' && !order.plannedRoute) order.plannedRoute = decimate(car.move.pts, 140);
    order.rideMeters = Math.round(m);
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
    if (order.sos && order.sos.active) order.sos.active = false;
    if (car) {
      this._stopAt(car, now);
      car.earnings.rides++;
      car.earnings[order.payment === 'card' ? 'card' : 'cash'] += order.fare;
      car.status = STATUS.liber;
      car.orderId = null;
      car.atPickup = false; car.atDest = false;
      if (!car.human) this._goStation(state, car, now);
    }
    const key = phoneKey(order.client.phone);
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

  // comanda programată ajunge la ora ei
  _activate(state, o, now) {
    o.status = 'cautare';
    o.timeline.push({ t: now, s: 'activata' });
    const rc = o.reservedBy ? state.cars.find(c => c.id === o.reservedBy) : null;
    if (rc && !rc.orderId && rc.status !== STATUS.offline) {
      if (rc.offerId) { const other = state.orders.find(x => x.id === rc.offerId); if (other) this.refuse(state, other, rc, now); }
      this.accept(state, o, rc, now);
      o.fromReservation = true;
      return;
    }
    if (rc) this.alert(state, 'rezervare', `Șoferul rezervat (${rc.cs}) nu e disponibil pentru #${o.code}. Se caută alt șofer.`, { orderId: o.id }, now);
    this.dispatch(state, o, now);
  }

  alert(state, kind, text, extra = {}, now = Date.now(), info = false) {
    state.alerts.push({ id: uid('a'), t: now, kind, text, ack: false, info, ...extra });
    if (state.alerts.length > 50) state.alerts.splice(0, state.alerts.length - 50);
  }

  message(state, orderId, from, text, now = Date.now()) {
    (state.chats[orderId] ||= []).push({ from, text, t: now });
  }

  // ---------- apeluri (prin centrală, numerele rămân ascunse) ----------
  callStart(state, p, now) {
    // un singur apel activ pe persoană
    state.calls = state.calls.filter(c => c.status !== 'ended' || now - c.endedAt < 60e3);
    const busy = state.calls.find(c => c.status !== 'ended' && ([c.from.id, c.to.id].includes(p.to.id)));
    const call = { id: p.id || uid('c'), orderId: p.orderId || null, from: p.from, to: p.to, status: busy ? 'ended' : 'ringing', at: now, endedAt: busy ? now : null, endReason: busy ? 'ocupat' : null };
    // cine răspunde automat în demo: șoferii simulați, clienții care au sunat la dispecerat, dispeceratul
    const order = call.orderId && state.orders.find(o => o.id === call.orderId);
    const t = p.to;
    let auto = false;
    if (t.role === 'sofer') { const car = state.cars.find(c => c.id === t.id); auto = car && !car.human; }
    else if (t.role === 'client') auto = !order || order.source !== 'app';
    else if (t.role === 'dispecer') auto = !!p.autoDispatch;
    if (auto && !busy) call.answerAt = now + rnd(2200, 3800);
    state.calls.push(call);
    if (state.calls.length > 20) state.calls.splice(0, state.calls.length - 20);
  }

  // ---------- tick ----------
  tick(state, now = Date.now()) {
    let changed = false;
    // programate: răspuns la cereri, rezervări automate, activare
    for (const o of state.orders) {
      if (o.status !== 'programata') continue;
      if (o.request && o.request.status === 'pending' && o.request.respondAt && now >= o.request.respondAt) {
        this._respond(state, o, Math.random() < 0.85, now); changed = true;
      }
      if (!o.reservedBy && o.autoReserveAt && now >= o.autoReserveAt) {
        o.autoReserveAt = null;
        const sims = state.cars.filter(c => !c.human && c.status !== STATUS.offline);
        const req = reqOptions(o.options);
        const fit = sims.filter(c => req.every(k => carHas(c, k)));
        const c = pick(fit.length ? fit : sims);
        if (c) { o.reservedBy = c.id; o.timeline.push({ t: now, s: 'rezervata', car: c.id }); changed = true; }
      }
      if (now >= o.activateAt) { this._activate(state, o, now); changed = true; }
    }
    // oferte (comenzile prioritare primele)
    const list = state.orders.slice().sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
    for (const o of list) {
      if (o.status === 'cautare' && !o.offer) { this.dispatch(state, o, now); changed = true; continue; }
      if (o.status === 'oferita' && o.offer) {
        const car = state.cars.find(c => c.id === o.offer.carId);
        if (!car) { o.status = 'cautare'; o.offer = null; continue; }
        if (o.offer.autoAt && now >= o.offer.autoAt) { this.accept(state, o, car, now); changed = true; }
        else if (now >= o.offer.until) { this.refuse(state, o, car, now, true); changed = true; }
      }
    }
    // traseul real al curselor (pentru „Distribuie cursa” și istoric)
    for (const o of state.orders) {
      if (o.source === 'fundal' || !['acceptata', 'sosit', 'in_cursa'].includes(o.status)) continue;
      const car = state.cars.find(c => c.id === o.carId); if (!car) continue;
      if (now - (o.lastTrack || 0) < 2000) continue;
      o.lastTrack = now;
      const p = carPos(car, now).p;
      const last = o.track[o.track.length - 1];
      if (!last || dist(last, p) > 8) {
        o.track.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
        if (o.track.length > 450) o.track.splice(1, 1);
        changed = true;
      }
    }
    // mașini
    for (const car of state.cars) {
      if (car.status === STATUS.pauza && car.pauseUntil && now >= car.pauseUntil) {
        if (car.human) { if (!car.pauseOver) { car.pauseOver = true; changed = true; } }
        else { car.status = STATUS.liber; car.pauseUntil = null; car.queuedAt = now; changed = true; }
      }
      if (car.move) {
        const pos = carPos(car, now);
        if (!pos.done) continue;
        changed = true;
        const kind = car.move.kind;
        const order = state.orders.find(o => o.id === car.orderId);
        this._stopAt(car, now);
        if (kind === 'pickup' && order) {
          if (car.human) car.atPickup = true;
          else this.arrived(state, order, now);
        } else if (kind === 'ride' && order) {
          if (car.human) car.atDest = true;
          else this.finish(state, order, now);
        } else if (kind === 'station') {
          car.station = car.targetStation || this.nearestStation([car.lat, car.lon]).id;
          car.queuedAt = now;
        } else if (kind === 'cruise') {
          if (car.status === STATUS.liber && !car.human) this._goStation(state, car, now);
        }
      } else if (!car.human) {
        const order = state.orders.find(o => o.id === car.orderId);
        if (order && order.status === 'sosit' && car.wait && now >= car.wait) { car.wait = 0; this.pickedUp(state, order, now); changed = true; }
        else if (car.status === STATUS.liber && car.station && !car.offerId && Math.random() < 0.00004 * state.speedMul) {
          car.status = STATUS.pauza; car.pauseUntil = now + rnd(3, 9) * 60e3; changed = true;
        } else if (car.status === STATUS.liber && car.station && !car.offerId && Math.random() < 0.0004 * state.speedMul) {
          const q = stationQueue(state, car.station);
          if (q.length >= 3 && q[q.length - 1].id === car.id) {
            const target = CONFIG.stations.slice().sort((a, b) => stationQueue(state, a.id).length - stationQueue(state, b.id).length)[0];
            if (target.id !== car.station) { this._goStation(state, car, now, target.id); changed = true; }
          }
        }
      }
    }
    // apeluri: răspuns automat / nepreluate
    for (const c of state.calls) {
      if (c.status === 'ringing' && c.answerAt && now >= c.answerAt) { c.status = 'active'; c.answeredAt = now; changed = true; }
      else if (c.status === 'ringing' && now - c.at > 30e3) { c.status = 'ended'; c.endedAt = now; c.endReason = 'nepreluat'; changed = true; }
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

  _respond(state, o, yes, now) {
    if (!o.request || o.request.status !== 'pending') return;
    const car = state.cars.find(c => c.id === o.request.carId);
    o.request.status = yes ? 'accepted' : 'refused';
    o.request.answeredAt = now;
    if (yes) { o.reservedBy = o.request.carId; o.timeline.push({ t: now, s: 'rezervata', car: o.request.carId }); }
    else {
      o.timeline.push({ t: now, s: 'cerere_refuzata', car: o.request.carId });
      o.requestCar = null;
      // la ora aleasă trimitem cel mai apropiat taxi liber
      o.activateAt = Math.min(o.activateAt, o.scheduledFor);
    }
    if (car && !yes && o.source !== 'fundal') this.alert(state, 'info', `${car.driver} (${car.cs}) nu poate prelua cererea #${o.code}. Va merge cel mai apropiat taxi.`, { orderId: o.id }, now, true);
  }

  // ---------- acțiuni venite din interfețe ----------
  apply(state, action, p, now = Date.now()) {
    const order = p && p.orderId ? state.orders.find(o => o.id === p.orderId) : null;
    const car = p && p.carId ? state.cars.find(c => c.id === p.carId) : null;
    switch (action) {
      case 'createOrder': this.createOrder(state, p, now); break;
      case 'cancelOrder': if (order) this.cancel(state, order, p.by || 'client', p.reason, now); break;
      case 'message': if (order) this.message(state, order.id, p.from, p.text, now); break;

      // recenzii și bacșiș
      case 'rateOrder': if (order) {
        order.review = { stars: p.stars, tags: p.tags || [], text: p.text || '' };
        const c = state.cars.find(x => x.id === order.carId);
        if (c && p.stars) {
          c.reviews.unshift({ stars: p.stars, text: p.text || (p.tags || []).join(', ') || '', by: (order.client.name || '').split(' ')[0], t: now });
          c.reviews = c.reviews.slice(0, 12);
          c.rating = avgRating(c.reviews, c.baseRating);
        }
      } break;
      case 'tip': if (order && p.amount > 0) {
        order.tip = { amount: Math.round(p.amount * 100) / 100, method: p.method };
        const c = state.cars.find(x => x.id === order.carId);
        if (c) { c.earnings.tips = (c.earnings.tips || 0) + order.tip.amount; c.earnings[p.method === 'card' ? 'card' : 'cash'] += order.tip.amount; }
        order.timeline.push({ t: now, s: 'bacsis', fare: order.tip.amount });
      } break;
      case 'rateClient': if (order) {
        order.driverReview = { stars: p.stars, tags: p.tags || [], text: p.text || '' };
        const key = phoneKey(order.client.phone);
        const cl = state.clients[key] || (state.clients[key] = { name: order.client.name, phone: order.client.phone, rides: 1, reviews: [], history: [] });
        const c = state.cars.find(x => x.id === order.carId);
        cl.reviews = [{ stars: p.stars, text: p.text || (p.tags || []).join(', '), by: c ? c.driver.split(' ')[0] : 'Șofer', t: now }, ...(cl.reviews || [])].slice(0, 12);
      } break;
      case 'setPhoto':
        if (p.role === 'sofer' && car) car.photo = p.photo || null;
        if (p.role === 'client') { const key = phoneKey(p.phone); if (key) { const cl = state.clients[key] || (state.clients[key] = { name: p.name, phone: p.phone, rides: 0, reviews: [], history: [] }); cl.photo = p.photo || null; } }
        break;

      // siguranță
      case 'clientSos': if (order) {
        const c = state.cars.find(x => x.id === order.carId);
        order.sos = { at: now, active: true, by: 'client' };
        if (c) { c.recording = true; c.recordingSince = now; }
        const pos = c ? carPos(c, now).p : [order.pickup.lat, order.pickup.lon];
        this.alert(state, 'sos', `SOS de la clienta/clientul ${order.client.name} în mașina ${c ? c.cs + ' (' + c.plate + ')' : ''} · comanda #${order.code}`, { orderId: order.id, carId: c && c.id, by: 'client', lat: pos[0], lon: pos[1] }, now);
      } break;
      case 'sos': if (car) {
        car.recording = true; car.recordingSince = now;
        const pos = carPos(car, now).p;
        this.alert(state, 'sos', `SOS de la șoferul ${car.driver} (${car.cs} · ${car.plate})`, { carId: car.id, by: 'sofer', lat: pos[0], lon: pos[1] }, now);
      } break;
      case 'resolveSos': {
        const cid = p.carId;
        const c = state.cars.find(x => x.id === cid);
        if (c) { c.recording = false; c.recordingSince = null; }
        state.orders.forEach(o => { if (o.carId === cid && o.sos) o.sos.active = false; });
        state.alerts.forEach(a => { if (a.kind === 'sos' && a.carId === cid) a.ack = true; });
      } break;

      // apeluri
      case 'callStart': this.callStart(state, p, now); break;
      case 'callAnswer': { const c = state.calls.find(x => x.id === p.id); if (c && c.status === 'ringing') { c.status = 'active'; c.answeredAt = now; } } break;
      case 'callEnd': { const c = state.calls.find(x => x.id === p.id); if (c && c.status !== 'ended') { c.endReason = c.status === 'ringing' ? (p.by === c.to.role ? 'respins' : 'anulat') : 'terminat'; c.status = 'ended'; c.endedAt = now; } } break;

      // mesaje dispecerat <-> șoferi
      case 'driverMsg':
        state.driverMsgs.push({ id: uid('m'), to: p.carId || 'toti', from: p.from || 'dispecer', text: p.text, t: now });
        if (state.driverMsgs.length > 40) state.driverMsgs.splice(0, state.driverMsgs.length - 40);
        break;

      case 'driverLogin': if (car) {
        car.status = STATUS.liber; car.shiftStart = now; car.pauseUntil = null; car.pauseOver = false;
        if (!car.move) { const st = this.nearestStation([car.lat, car.lon]); if (dist([car.lat, car.lon], [st.lat, st.lon]) < 120) { car.station = st.id; car.queuedAt = now; } }
      } break;
      case 'driverLogout': if (car && !car.orderId) { car.status = STATUS.offline; car.station = null; if (car.offerId) { const o = state.orders.find(x => x.id === car.offerId); if (o) this.refuse(state, o, car, now); } } break;
      case 'driverStatus': if (car && !car.orderId) {
        car.status = p.status;
        car.pauseOver = false;
        if (p.status === STATUS.liber) {
          car.pauseUntil = null;
          const st = this.nearestStation(carPos(car, now).p);
          if (!car.move && dist([car.lat, car.lon], [st.lat, st.lon]) < 150) { car.station = st.id; car.queuedAt = now; }
        } else if (p.status === STATUS.pauza) {
          car.pauseUntil = p.minutes ? now + p.minutes * 60e3 : null;
          if (car.move) this._stopAt(car, now);
          if (car.offerId) { const o = state.orders.find(x => x.id === car.offerId); if (o) this.refuse(state, o, car, now); }
        }
      } break;
      case 'extendPause': if (car && car.status === STATUS.pauza) { car.pauseUntil = Math.max(now, car.pauseUntil || now) + p.minutes * 60e3; car.pauseOver = false; } break;
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
        order.carId = null; order.status = 'cautare'; order.offer = null;
        order.timeline.push({ t: now, s: 'realocata' });
        this.alert(state, 'refuz', `${c ? c.driver + ' (' + c.cs + ')' : 'Șoferul'} nu poate ajunge la comanda #${order.code}. Se caută alt șofer.`, { orderId: order.id }, now);
        this.dispatch(state, order, now);
      } break;
      case 'noShow': if (order) this.cancel(state, order, 'sofer', 'Clientul nu s-a prezentat', now); break;

      // programări
      case 'respondRequest': if (order) this._respond(state, order, !!p.accept, now); break;
      case 'reserve': if (order && car && order.status === 'programata') {
        order.reservedBy = car.id; order.timeline.push({ t: now, s: 'rezervata', car: car.id });
        if (order.request && order.request.status === 'pending' && order.request.carId === car.id) order.request.status = 'accepted';
      } break;
      case 'unreserve': if (order && order.status === 'programata') { order.reservedBy = null; order.timeline.push({ t: now, s: 'rezervare_anulata' }); } break;

      case 'assign': if (order && car) {
        if (order.status === 'programata') { order.reservedBy = car.id; order.timeline.push({ t: now, s: 'rezervata', car: car.id }); break; }
        if (order.offer) { const oc = state.cars.find(c => c.id === order.offer.carId); if (oc) oc.offerId = null; order.offer = null; }
        if (['cautare', 'oferita'].includes(order.status) && car.status === STATUS.liber && !car.offerId) {
          order.status = 'cautare'; order.forceCar = car.id; order.refused = order.refused.filter(id => id !== car.id);
          this.dispatch(state, order, now);
        }
      } break;
      case 'setPriority': if (order) order.priority = !!p.value; break;
      case 'ackAlert': { const a = state.alerts.find(x => x.id === p.id); if (a) a.ack = true; } break;
      case 'ackAll': state.alerts.forEach(a => { if (a.kind !== 'sos') a.ack = true; }); break;
      case 'setSpeed': this.setSpeed(state, p.mul, now); break;
      case 'setFlag': state[p.key] = !!p.value; break;
      case 'reset': return 'reset';
    }
    return null;
  }
}
