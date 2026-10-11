// Harta orașului: graf de străzi reale (OpenStreetMap), rutare A*, căutare adrese.
import { CONFIG } from '../config.js';

const R = 6371000;
const toRad = d => d * Math.PI / 180;

export function dist(a, b) {
  // a, b: [lat, lon] -> metri (suficient de precis la scară de oraș)
  const x = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2));
  const y = toRad(b[0] - a[0]);
  return Math.sqrt(x * x + y * y) * R;
}

export function bearing(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ș|ş/g, 's').replace(/ț|ţ/g, 't')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const STREET_PREFIX = /^(strada|str|aleea|calea|bulevardul|bd|piata|drumul|soseaua|intrarea|splaiul) /;

export function shortStreet(name) {
  return (name || '')
    .replace(/^Strada /, 'Str. ')
    .replace(/^Bulevardul /, 'Bd. ')
    .replace(/^Aleea /, 'Aleea ');
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class CityMap {
  static async load(url = CONFIG.map.dataUrl) {
    // în simulatorul dintr-o singură pagină, datele vin deja încărcate
    let pre = null;
    try { pre = window.__CITY_DATA || (window.parent !== window && window.parent.__CITY_DATA) || null; } catch { pre = null; }
    if (pre) return new CityMap(pre);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Nu am putut încărca harta orașului');
    return new CityMap(await res.json());
  }

  constructor(d) {
    this.raw = d;
    const n = d.coords.length / 2;
    this.n = n;
    this.lat = new Float64Array(n); this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.lat[i] = d.coords[2 * i]; this.lon[i] = d.coords[2 * i + 1]; }
    this.names = d.names;

    // Liste de adiacență (orientate și neorientate)
    const out = Array.from({ length: n }, () => []);
    const und = Array.from({ length: n }, () => []);
    const E = d.edges;
    for (let k = 0; k < E.length; k += 4) {
      const a = E[k], b = E[k + 1], one = E[k + 2], nm = E[k + 3];
      const w = dist([this.lat[a], this.lon[a]], [this.lat[b], this.lon[b]]);
      out[a].push(b, w, nm);
      if (!one) out[b].push(a, w, nm);
      und[a].push(b, w, nm); und[b].push(a, w, nm);
    }
    this.out = out; this.und = und;

    // Componenta conexă principală (ca să nu ne „lipim” de drumuri izolate)
    const comp = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0, c = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      let size = 0; const st = [s]; comp[s] = c;
      while (st.length) {
        const u = st.pop(); size++;
        const L = und[u];
        for (let j = 0; j < L.length; j += 3) { const v = L[j]; if (comp[v] === -1) { comp[v] = c; st.push(v); } }
      }
      if (size > bestSize) { bestSize = size; best = c; }
      c++;
    }
    this.main = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.main[i] = comp[i] === best ? 1 : 0;

    // Index spațial pe grilă
    this.cell = 0.0025;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!this.main[i] || !out[i].length) continue;
      const key = this._key(this.lat[i], this.lon[i]);
      let arr = this.grid.get(key); if (!arr) this.grid.set(key, arr = []); arr.push(i);
    }
    this.addrGrid = new Map();
    d.addresses.forEach((a, i) => {
      const key = this._key(a[2], a[3]);
      let arr = this.addrGrid.get(key); if (!arr) this.addrGrid.set(key, arr = []); arr.push(i);
    });

    this._buildSearch();
  }

  _key(la, lo) { return Math.floor(la / this.cell) + ':' + Math.floor(lo / this.cell); }

  nearestNode(p) {
    const ci = Math.floor(p[0] / this.cell), cj = Math.floor(p[1] / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 6 && (best === -1 || r <= 2); r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const arr = this.grid.get(i + ':' + j); if (!arr) continue;
        for (const k of arr) {
          const d2 = dist(p, [this.lat[k], this.lon[k]]);
          if (d2 < bd) { bd = d2; best = k; }
        }
      }
    }
    return best;
  }

  pt(i) { return [this.lat[i], this.lon[i]]; }

  _astar(s, t, adj) {
    const n = this.n;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const tp = this.pt(t);
    const h = i => dist([this.lat[i], this.lon[i]], tp);
    const heap = new MinHeap();
    g[s] = 0; heap.push(h(s), s);
    while (heap.size) {
      const u = heap.pop();
      if (closed[u]) continue; closed[u] = 1;
      if (u === t) break;
      const L = adj[u];
      for (let j = 0; j < L.length; j += 3) {
        const v = L[j], nd = g[u] + L[j + 1];
        if (nd < g[v]) { g[v] = nd; prev[v] = u; heap.push(nd + h(v), v); }
      }
    }
    if (g[t] === Infinity) return null;
    const path = [];
    for (let u = t; u !== -1; u = prev[u]) path.push(u);
    return path.reverse();
  }

  // Rută pe străzi reale între două puncte [lat,lon]. Întoarce { pts, meters }.
  route(from, to) {
    const s = this.nearestNode(from), t = this.nearestNode(to);
    let ids = s === t ? [s] : (this._astar(s, t, this.out) || this._astar(s, t, this.und));
    if (!ids) ids = [s, t];
    const pts = [from.slice(0, 2)];
    for (const i of ids) pts.push(this.pt(i));
    pts.push(to.slice(0, 2));
    // elimină puncte duplicate
    const clean = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (dist(clean[clean.length - 1], pts[i]) > 0.5) clean.push(pts[i]);
    if (clean.length === 1) clean.push(to.slice(0, 2));
    let meters = 0;
    for (let i = 1; i < clean.length; i++) meters += dist(clean[i - 1], clean[i]);
    return { pts: clean.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]), meters };
  }

  // Punct aleator pe o stradă (pentru comenzi „de fundal” în demo)
  randomPoint(rand = Math.random, maxFromCenter = 3200) {
    for (let k = 0; k < 8; k++) {
      const p = this._randomPoint(rand);
      if (dist([p.lat, p.lon], CONFIG.city.center) <= maxFromCenter) return p;
    }
    return this._randomPoint(rand);
  }

  _randomPoint(rand) {
    // preferă adrese reale; uneori un loc cunoscut
    const d = this.raw;
    if (rand() < 0.75 && d.addresses.length) {
      const a = d.addresses[Math.floor(rand() * d.addresses.length)];
      return { lat: a[2], lon: a[3], label: `${shortStreet(a[0])} ${a[1]}`, kind: 'adresa' };
    }
    const good = this._goodPois || (this._goodPois = d.pois.filter(p => ['cumparaturi', 'sanatate', 'turism', 'transport', 'educatie', 'mancare'].includes(p[3])));
    const p = good[Math.floor(rand() * good.length)];
    return { lat: p[1], lon: p[2], label: p[0], kind: 'loc' };
  }

  // Adresa unui punct (cea mai apropiată adresă reală sau strada)
  reverse(p) {
    const ci = Math.floor(p[0] / this.cell), cj = Math.floor(p[1] / this.cell);
    let best = null, bd = 70;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const arr = this.addrGrid.get(i + ':' + j); if (!arr) continue;
      for (const k of arr) {
        const a = this.raw.addresses[k];
        const d2 = dist(p, [a[2], a[3]]);
        if (d2 < bd) { bd = d2; best = a; }
      }
    }
    if (best) return `${shortStreet(best[0])} ${best[1]}`;
    const node = this.nearestNode(p);
    if (node >= 0) {
      const L = this.und[node];
      for (let j = 2; j < L.length; j += 3) if (L[j] >= 0 && this.names[L[j]]) return shortStreet(this.names[L[j]]);
    }
    return 'Punct pe hartă';
  }

  _buildSearch() {
    const d = this.raw;
    const items = [];
    for (const s of d.streets) items.push({ type: 'strada', label: shortStreet(s[0]), full: s[0], lat: s[1], lon: s[2], key: norm(s[0]).replace(STREET_PREFIX, '') });
    for (const p of d.pois) items.push({ type: p[3], label: p[0], sub: p[4] ? shortStreet(p[4]) : '', lat: p[1], lon: p[2], key: norm(p[0]) });
    this.searchItems = items;
    // adrese grupate pe stradă
    this.addrByStreet = new Map();
    for (const a of d.addresses) {
      const k = norm(a[0]).replace(STREET_PREFIX, '');
      let arr = this.addrByStreet.get(k); if (!arr) this.addrByStreet.set(k, arr = []); arr.push(a);
    }
  }

  search(q, limit = 8) {
    const nq = norm(q).replace(STREET_PREFIX, '');
    if (nq.length < 2) return [];
    const numMatch = nq.match(/^(.*?)\s*(?:nr )?(\d+[a-z]?)$/);
    const results = [];
    // Stradă + număr
    if (numMatch && numMatch[1].length >= 2) {
      const [, st, nr] = numMatch;
      for (const [k, arr] of this.addrByStreet) {
        if (!(k.startsWith(st) || k.includes(' ' + st) || k.includes(st))) continue;
        for (const a of arr) {
          const an = norm(a[1]);
          if (an === nr || an.startsWith(nr)) {
            results.push({ score: (an === nr ? 0 : 1) + (k.startsWith(st) ? 0 : 2), type: 'adresa', label: `${shortStreet(a[0])} ${a[1]}`, sub: CONFIG.city.name, lat: a[2], lon: a[3] });
          }
        }
      }
    }
    const words = nq.split(' ');
    for (const it of this.searchItems) {
      const k = it.key;
      let score = -1;
      if (k.startsWith(nq)) score = 3;
      else if (k.includes(' ' + nq)) score = 4;
      else if (words.every(w => k.includes(w))) score = 6;
      if (score < 0) continue;
      if (it.type === 'strada') score -= 0.5;
      if (['turism', 'cumparaturi', 'transport', 'sanatate', 'cartier'].includes(it.type)) score -= 0.3;
      results.push({ score, type: it.type, label: it.label, sub: it.sub || (it.type === 'strada' ? CONFIG.city.name : ''), lat: it.lat, lon: it.lon });
    }
    results.sort((a, b) => a.score - b.score || a.label.length - b.label.length);
    const seen = new Set(); const outR = [];
    for (const r of results) {
      const key = r.label + '|' + r.sub;
      if (seen.has(key)) continue; seen.add(key); outR.push(r);
      if (outR.length >= limit) break;
    }
    return outR;
  }

  // Segmente de străzi pentru desenarea hărții de rezervă (fără internet)
  roadLines() {
    if (this._lines) return this._lines;
    const lines = [];
    const E = this.raw.edges;
    for (let k = 0; k < E.length; k += 4) lines.push([this.pt(E[k]), this.pt(E[k + 1])]);
    return (this._lines = lines);
  }
}

// Parcurgere a unei rute: poziția la o anumită distanță de la start
export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
}

export function pointAt(pts, cum, d) {
  if (!pts || !pts.length) return null;
  if (d <= 0) return { p: pts[0], head: pts.length > 1 ? bearing(pts[0], pts[1]) : 0, i: 0 };
  const total = cum[cum.length - 1];
  if (d >= total) {
    const n = pts.length;
    return { p: pts[n - 1], head: n > 1 ? bearing(pts[n - 2], pts[n - 1]) : 0, i: n - 1, done: true };
  }
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (d - cum[lo]) / seg;
  const a = pts[lo], b = pts[hi];
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], head: bearing(a, b), i: lo };
}
