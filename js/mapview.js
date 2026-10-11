// Afișarea hărții și a flotei (Leaflet). Mașinile se mișcă lin, cadru cu cadru.
import { CONFIG } from '../config.js';
import { carPos, colorCat, stationQueue, remainingRoute } from './sim.js';
import { icon } from './icons.js';

const L = window.L;

export function createMap(el, { dark = false, center = CONFIG.city.center, zoom = CONFIG.city.zoom, cityMap = null } = {}) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, preferCanvas: false,
    zoomSnap: 0.25, wheelPxPerZoomLevel: 90, tapTolerance: 20,
    maxBounds: cityMap ? L.latLngBounds([cityMap.raw.bbox[0] - 0.03, cityMap.raw.bbox[1] - 0.05], [cityMap.raw.bbox[2] + 0.03, cityMap.raw.bbox[3] + 0.05]) : undefined,
    minZoom: 12, maxZoom: 19,
  }).setView(center, zoom);
  map.attributionControl.setPrefix(false);
  // harta se redimensionează când panourile își schimbă înălțimea
  if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(el);

  let tiles = null;
  let fallback = null;
  let errors = 0, loaded = 0;
  function setTiles(isDark) {
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(isDark ? CONFIG.map.tilesDark : CONFIG.map.tiles, {
      attribution: CONFIG.map.attribution, subdomains: 'abcd', maxZoom: 19, detectRetina: true,
    }).addTo(map);
    tiles.on('tileerror', () => { errors++; if (errors > 3 && loaded === 0) useFallback(); });
    tiles.on('tileload', () => { loaded++; if (fallback && loaded > 4) { fallback.forEach(l => map.removeLayer(l)); fallback = null; } });
  }
  // Hartă de rezervă desenată din datele locale, dacă nu se încarcă imaginile hărții
  function useFallback() {
    if (fallback || !cityMap) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    const renderer = L.canvas({ padding: 0.3 });
    const lines = cityMap.roadLines();
    fallback = [
      L.polyline(lines, { color: isDark ? '#2a2e36' : '#d9d5cb', weight: 7, opacity: 1, interactive: false, renderer }),
      L.polyline(lines, { color: isDark ? '#3d434e' : '#ffffff', weight: 4.5, opacity: 1, interactive: false, renderer }),
    ];
    fallback.forEach(l => { l.addTo(map); l.bringToBack(); });
  }
  setTiles(dark);
  setTimeout(() => { if (loaded === 0) useFallback(); }, 4000);

  map.setDark = (d) => { setTiles(d); if (fallback) { fallback.forEach(l => map.removeLayer(l)); fallback = null; if (loaded === 0) useFallback(); } };
  return map;
}

// Mașinuță de taxi văzută de sus: caroseria în culoarea stării, lampa TAXI galbenă pe plafon
export const CAR_COLOR = { liber: 'var(--free)', spre_client: 'var(--to)', cu_client: 'var(--busy)', pauza: 'var(--pause)', offline: 'var(--pause)' };
export function carSvg(cat, size = 36) {
  const w = Math.round(size * 0.6), h = size;
  const ghost = cat === 'pauza' || cat === 'offline';
  return `<svg class="taxi" width="${w}" height="${h}" viewBox="0 0 24 40" aria-hidden="true">
    <rect x="2.5" y="1.5" width="19" height="37" rx="7.5" fill="${CAR_COLOR[cat] || CAR_COLOR.liber}" stroke="${ghost ? 'var(--ghost-line)' : '#fff'}" stroke-width="1.8" ${ghost ? 'stroke-dasharray="3 2.4"' : ''}/>
    <rect x="5.6" y="9" width="12.8" height="6.4" rx="2.4" fill="rgba(15,18,24,.72)"/>
    <rect x="6.4" y="27.4" width="11.2" height="4.6" rx="1.8" fill="rgba(15,18,24,.62)"/>
    <rect x="7.6" y="18" width="8.8" height="6" rx="1.4" fill="#FFC21A" stroke="#3a2c00" stroke-width=".7"/>
    <text x="12" y="22.5" text-anchor="middle" font-size="3.6" font-weight="900" fill="#3a2c00" font-family="Arial, sans-serif">TAXI</text>
    <circle cx="7" cy="3.6" r="1.5" fill="#FFF6C9"/><circle cx="17" cy="3.6" r="1.5" fill="#FFF6C9"/>
  </svg>`;
}

function carHtml(cat, extra = '') {
  return `<div class="cring"></div><div class="rot">${carSvg(cat)}</div>${extra}`;
}

export class FleetLayer {
  constructor(map, opts = {}) {
    this.map = map;
    this.opts = opts;
    this.markers = new Map();
    this.standMarkers = new Map();
    this.state = null;
    this.layer = L.layerGroup().addTo(map);
    this.standLayer = L.layerGroup().addTo(map);
    if (opts.stations !== false) this._drawStations();
    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);
  }

  _drawStations() {
    for (const s of CONFIG.stations) {
      const m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: '', html: `<div class="stand-mk"><b>TAXI</b>${s.name}<span class="n"></span></div>`, iconSize: null, iconAnchor: [-14, 34] }),
        interactive: !!this.opts.onStation, keyboard: false, zIndexOffset: -500,
      }).addTo(this.standLayer);
      if (this.opts.onStation) m.on('click', () => this.opts.onStation(s));
      this.standMarkers.set(s.id, m);
    }
  }

  update(state) {
    this.state = state;
    const seen = new Set();
    const filter = this.opts.filter || (() => true);
    const queues = new Map();
    for (const s of CONFIG.stations) queues.set(s.id, stationQueue(state, s.id));
    for (const car of state.cars) {
      if (!filter(car)) continue;
      seen.add(car.id);
      const cat = colorCat(car);
      let m = this.markers.get(car.id);
      const isMe = this.opts.me && this.opts.me === car.id;
      const isSel = this.opts.selected && this.opts.selected() === car.id;
      const dim = this.opts.dim && this.opts.dim(car);
      const cls = `car-mk ${cat}${isMe ? ' me' : ''}${isSel ? ' sel' : ''}${dim ? ' dim' : ''}${car.recording ? ' rec' : ''}`;
      const tag = this.opts.tag ? this.opts.tag(car) : '';
      const key = cls + '|' + tag;
      if (!m) {
        m = L.marker([car.lat, car.lon], { icon: L.divIcon({ className: '', html: '', iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: isMe ? 1000 : 0, keyboard: false });
        m.addTo(this.layer);
        if (this.opts.onCar) m.on('click', () => this.opts.onCar(car.id));
        m._key = '';
        this.markers.set(car.id, m);
      }
      m._car = car;
      // în stație, mașinile stau la rând una lângă alta
      if (car.station && !car.move && car.status === 'liber') {
        const q = queues.get(car.station) || [];
        m._slot = q.findIndex(c => c.id === car.id);
      } else m._slot = -1;
      if (m._key !== key) {
        m._key = key;
        const html = `<div class="${cls}">${carHtml(cat, tag ? `<div class="tag">${tag}</div>` : '')}</div>`;
        const el = m.getElement();
        if (el) el.innerHTML = html;
        else m.setIcon(L.divIcon({ className: '', html, iconSize: [40, 40], iconAnchor: [20, 20] }));
        m._head = null;
        m.setZIndexOffset(isMe ? 1000 : isSel ? 900 : cat === 'pauza' ? 50 : 200);
      }
    }
    for (const [id, m] of this.markers) if (!seen.has(id)) { this.layer.removeLayer(m); this.markers.delete(id); }
    for (const [id, m] of this.standMarkers) {
      const n = (queues.get(id) || []).length;
      const el = m.getElement();
      if (el) { const span = el.querySelector('.n'); if (span) span.textContent = n ? ` · ${n}` : ''; }
    }
  }

  _raf() {
    const now = Date.now();
    for (const m of this.markers.values()) {
      const car = m._car; if (!car) continue;
      let p, head;
      if (m._slot >= 0) {
        const st = CONFIG.stations.find(s => s.id === car.station);
        const k = m._slot;
        const base = this.map.latLngToLayerPoint([st.lat, st.lon]);
        const pt = base.add([10 + (k % 5) * 24, 30 + Math.floor(k / 5) * 40]);
        p = this.map.layerPointToLatLng(pt);
        head = 0;
      } else {
        const pos = carPos(car, now);
        p = pos.p; head = pos.head || 0;
      }
      m.setLatLng(p);
      const el = m.getElement();
      if (el) {
        const r = el.querySelector('.rot');
        if (r && m._head !== Math.round(head)) {
          const prev = m._headRaw ?? head;
          const delta = ((head - (prev % 360)) + 540) % 360 - 180;
          m._headRaw = prev + delta;
          m._head = Math.round(head);
          r.style.transform = `rotate(${m._headRaw}deg)`;
        }
      }
    }
    if (this.opts.onFrame) this.opts.onFrame(now);
    requestAnimationFrame(this._raf);
  }

  carLatLng(id) {
    const m = this.markers.get(id);
    return m ? m.getLatLng() : null;
  }
}

export function pinIcon(kind = 'pickup', ic = 'person') {
  const cls = kind === 'dest' ? 'pin-mk dest' : kind === 'sos' ? 'pin-mk sos' : kind === 'order' ? 'pin-mk order-mk' : 'pin-mk';
  const size = kind === 'order' ? [32, 44] : [40, 52];
  return L.divIcon({ className: '', html: `<div class="${cls}"><div class="head">${icon(ic, { size: kind === 'order' ? 16 : 20, stroke: 2.2 })}</div><div class="stem"></div></div>`, iconSize: size, iconAnchor: [size[0] / 2, size[1]] });
}

// Linie de rută: un contur alb + culoare, ca să se vadă pe orice fundal
export class RouteLine {
  constructor(map, color = 'var(--ink)') {
    this.map = map;
    this.casing = L.polyline([], { color: '#fff', weight: 9, opacity: .95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    this.line = L.polyline([], { color, weight: 5, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  }
  set(pts, color) {
    this.casing.setLatLngs(pts || []);
    this.line.setLatLngs(pts || []);
    if (color) this.line.setStyle({ color });
  }
  setDashed(d) { this.line.setStyle({ dashArray: d ? '2 10' : null }); }
  clear() { this.set([]); }
  remove() { this.map.removeLayer(this.casing); this.map.removeLayer(this.line); }
}

// Străzile aglomerate (trafic live)
export class TrafficLayer {
  constructor(map, cityMap) { this.map = map; this.city = cityMap; this.group = L.layerGroup(); this.on = false; this.at = -1; }
  show(v) {
    this.on = v;
    if (v) { this.group.addTo(this.map); this.refresh(); } else this.map.removeLayer(this.group);
  }
  refresh() {
    if (!this.on) return;
    this.city.updateTraffic();
    if (this.at === this.city.trafficAt) return;
    this.at = this.city.trafficAt;
    this.group.clearLayers();
    const renderer = L.canvas({ padding: 0.3 });
    const lines = this.city.trafficLines(1.35);
    const lvl1 = lines.filter(l => l.level === 1).map(l => l.pts), lvl2 = lines.filter(l => l.level === 2).map(l => l.pts);
    if (lvl1.length) L.polyline(lvl1, { color: '#F59E0B', weight: 4, opacity: .75, interactive: false, renderer }).addTo(this.group);
    if (lvl2.length) L.polyline(lvl2, { color: '#E5484D', weight: 4.5, opacity: .8, interactive: false, renderer }).addTo(this.group);
  }
}

export function carRoute(car) { return remainingRoute(car); }

export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function legendHtml(counts, compact = false) {
  const items = [
    ['liber', 'Liber'],
    ['spre_client', 'Merge la comandă'],
    ['cu_client', 'Cu client'],
    ['pauza', 'Pauză'],
  ];
  return items.map(([k, label]) => `<span class="pill" data-cat="${k}"><span class="lg-car ${k}">${carSvg(k, 18)}</span>${compact ? '' : label}${counts ? ` <b>${counts[k] || 0}</b>` : ''}</span>`).join('');
}
