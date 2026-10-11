// Afișarea hărții și a flotei (Leaflet). Mașinile se mișcă lin, cadru cu cadru.
import { CONFIG } from '../config.js';
import { carPos, carCategory, stationQueue, remainingRoute } from './sim.js';
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
    tiles.on('tileerror', () => { errors++; if (errors > 6 && loaded === 0) useFallback(); });
    tiles.on('tileload', () => { loaded++; if (fallback && loaded > 4) { map.removeLayer(fallback); fallback = null; } });
  }
  // Hartă de rezervă desenată din datele locale, dacă nu se încarcă imaginile hărții
  function useFallback() {
    if (fallback || !cityMap) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    fallback = L.polyline(cityMap.roadLines(), {
      color: isDark ? '#3a3f49' : '#ffffff', weight: 4, opacity: 1, interactive: false,
      renderer: L.canvas({ padding: 0.3 }),
    }).addTo(map);
    fallback.bringToBack();
  }
  setTiles(dark);
  setTimeout(() => { if (loaded === 0) useFallback(); }, 6000);

  map.setDark = (d) => { setTiles(d); if (fallback) { map.removeLayer(fallback); fallback = null; if (loaded === 0) useFallback(); } };
  return map;
}

function carHtml(cat, head, extra = '') {
  const moving = cat !== 'liber_statie' && cat !== 'pauza' && cat !== 'offline';
  const inner = moving
    ? `<svg class="arrow" style="transform:rotate(${head}deg)" width="18" height="18" viewBox="0 0 24 24"><path d="M12 3l6.5 16L12 15.5 5.5 19z" fill="#fff"/></svg>`
    : cat === 'liber_statie' ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M8 7h8M12 7v10"/></svg>`
      : icon('pause', { size: 15, stroke: 2.4 });
  return `<div class="in">${inner}</div>${extra}`;
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
      const cat = carCategory(car);
      let m = this.markers.get(car.id);
      const isMe = this.opts.me && this.opts.me === car.id;
      const isSel = this.opts.selected && this.opts.selected() === car.id;
      const dim = this.opts.dim && this.opts.dim(car);
      const cls = `car-mk ${cat}${isMe ? ' me' : ''}${isSel ? ' sel' : ''}${dim ? ' dim' : ''}`;
      const tag = this.opts.tag ? this.opts.tag(car) : '';
      const key = cls + '|' + tag;
      if (!m) {
        m = L.marker([car.lat, car.lon], { icon: L.divIcon({ className: '', html: '', iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: isMe ? 1000 : 0, keyboard: false });
        m.addTo(this.layer);
        if (this.opts.onCar) m.on('click', () => this.opts.onCar(car.id));
        m._key = '';
        this.markers.set(car.id, m);
      }
      m._car = car;
      // poziție în stație: mașinile stau „la coadă” una lângă alta
      if (cat === 'liber_statie') {
        const q = queues.get(car.station) || [];
        m._slot = q.findIndex(c => c.id === car.id);
      } else m._slot = -1;
      if (m._key !== key) {
        m._key = key;
        const el = m.getElement();
        const html = `<div class="${cls}">${carHtml(cat, m._headRaw || 0, tag ? `<div class="tag">${tag}</div>` : '')}</div>`;
        if (el) el.innerHTML = html;
        else m.setIcon(L.divIcon({ className: '', html, iconSize: [36, 36], iconAnchor: [18, 18] }));
        m._head = null;
        m.setZIndexOffset(isMe ? 1000 : isSel ? 900 : cat === 'liber_statie' ? 100 : 200);
      }
    }
    for (const [id, m] of this.markers) if (!seen.has(id)) { this.layer.removeLayer(m); this.markers.delete(id); }
    // numărul de mașini din fiecare stație
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
      let p, head = 0;
      if (m._slot >= 0) {
        const st = CONFIG.stations.find(s => s.id === car.station);
        const k = m._slot;
        // rând de mașini spre dreapta-jos a stației, în pixeli constanți
        const base = this.map.latLngToLayerPoint([st.lat, st.lon]);
        const pt = base.add([4 + (k % 4) * 30, 22 + Math.floor(k / 4) * 30]);
        p = this.map.layerPointToLatLng(pt);
      } else {
        const pos = carPos(car, now);
        p = pos.p; head = pos.head;
      }
      m.setLatLng(p);
      const el = m.getElement();
      if (el) {
        const a = el.querySelector('.arrow');
        if (a && m._head !== Math.round(head)) {
          // rotația pe drumul cel mai scurt
          const prev = m._headRaw ?? head;
          let delta = ((head - (prev % 360)) + 540) % 360 - 180;
          m._headRaw = prev + delta;
          m._head = Math.round(head);
          a.style.transform = `rotate(${m._headRaw}deg)`;
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

export function carRoute(car) { return remainingRoute(car); }

export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function legendHtml(counts, compact = false) {
  const items = [
    ['liber_statie', 'Liber în stație', 'var(--free)', true],
    ['liber_drum', 'Liber pe drum', 'var(--free)', false],
    ['spre_client', 'Merge la client', 'var(--to)', false],
    ['cu_client', 'Cu client', 'var(--busy)', false],
  ];
  return items.map(([k, label, c, sq]) => `<span class="pill" data-cat="${k}"><span class="sw${sq ? ' sq' : ''}" style="background:${c}"></span>${compact ? '' : label}${counts ? ` <b>${counts[k] || 0}</b>` : ''}</span>`).join('');
}
