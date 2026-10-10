// Descarcă din OpenStreetMap străzile, adresele, locurile cunoscute și stațiile de taxi
// pentru orașul din tools/city.json și le salvează compact în data/city-map.json.
// Rulează automat pe GitHub (workflow "Date hartă"), sau local: node tools/build-map-data.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const city = JSON.parse(await readFile(new URL('./city.json', import.meta.url), 'utf8'));
const [s, w, n, e] = city.bbox; // sud, vest, nord, est
const bbox = `${s},${w},${n},${e}`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'taxi-app-map-builder/1.0' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.warn('Overpass a eșuat:', err.message);
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }
  throw lastErr;
}

const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road';

console.log('Descarc străzile…');
const roads = await overpass(`[out:json][timeout:120];
way["highway"~"^(${DRIVABLE})$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"]["area"!="yes"](${bbox});
out geom;`);

console.log('Descarc locuri, adrese și stații…');
const places = await overpass(`[out:json][timeout:120];
(
  nwr["name"]["amenity"](${bbox});
  nwr["name"]["shop"](${bbox});
  nwr["name"]["tourism"](${bbox});
  nwr["name"]["leisure"](${bbox});
  nwr["name"]["office"](${bbox});
  nwr["name"]["healthcare"](${bbox});
  nwr["name"]["railway"="station"](${bbox});
  nwr["name"]["public_transport"="station"](${bbox});
  nwr["name"]["historic"](${bbox});
  nwr["name"]["place"~"^(suburb|neighbourhood|quarter|village|hamlet)$"](${bbox});
  nwr["addr:housenumber"]["addr:street"](${bbox});
  nwr["amenity"="taxi"](${bbox});
);
out center tags;`);

// ---------- Graf de drumuri ----------
const r5 = v => Math.round(v * 1e5) / 1e5;
const nodeIndex = new Map(); // osm id -> index
const coords = [];           // [lat, lon, lat, lon, ...]
const edges = [];            // [a, b, flags, nameIdx]  flags: 1 = sens unic a->b
const names = [];
const nameIdx = new Map();
const streetPts = new Map(); // nume stradă -> puncte pentru centru

function idx(id, lat, lon) {
  let i = nodeIndex.get(id);
  if (i === undefined) {
    i = coords.length / 2;
    nodeIndex.set(id, i);
    coords.push(r5(lat), r5(lon));
  }
  return i;
}
function nIdx(name) {
  if (!name) return -1;
  let i = nameIdx.get(name);
  if (i === undefined) { i = names.length; names.push(name); nameIdx.set(name, i); }
  return i;
}

for (const way of roads.elements) {
  if (way.type !== 'way' || !way.geometry) continue;
  const t = way.tags || {};
  let oneway = 0;
  if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular' || t.highway === 'motorway') oneway = 1;
  let ids = way.nodes, geom = way.geometry;
  if (t.oneway === '-1') { oneway = 1; ids = [...ids].reverse(); geom = [...geom].reverse(); }
  const ni = nIdx(t.name || t.ref || '');
  for (let k = 0; k < ids.length - 1; k++) {
    const a = idx(ids[k], geom[k].lat, geom[k].lon);
    const b = idx(ids[k + 1], geom[k + 1].lat, geom[k + 1].lon);
    if (a !== b) edges.push(a, b, oneway, ni);
  }
  if (t.name) {
    const arr = streetPts.get(t.name) || [];
    for (const g of geom) arr.push([g.lat, g.lon]);
    streetPts.set(t.name, arr);
  }
}

// ---------- Locuri, adrese, stații ----------
const pois = [];
const addresses = [];
const taxiStands = [];
const seen = new Set();
function categoryOf(t) {
  if (t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare) return 'sanatate';
  if (t.amenity === 'pharmacy') return 'farmacie';
  if (t.shop === 'supermarket' || t.shop === 'mall' || t.shop === 'department_store') return 'cumparaturi';
  if (t.shop) return 'magazin';
  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'pub' || t.amenity === 'bar') return 'mancare';
  if (t.amenity === 'school' || t.amenity === 'kindergarten' || t.amenity === 'college' || t.amenity === 'university') return 'educatie';
  if (t.railway || t.public_transport || t.amenity === 'bus_station') return 'transport';
  if (t.tourism || t.historic || t.leisure) return 'turism';
  if (t.amenity === 'place_of_worship') return 'biserica';
  if (t.place) return 'cartier';
  return 'altele';
}
for (const el of places.elements) {
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  const t = el.tags || {};
  if (t.amenity === 'taxi') {
    taxiStands.push({ name: t.name || '', lat: r5(lat), lon: r5(lon) });
    continue;
  }
  if (t.name) {
    const key = t.name + '|' + Math.round(lat * 500) + '|' + Math.round(lon * 500);
    if (!seen.has(key)) {
      seen.add(key);
      const street = t['addr:street'] ? `${t['addr:street']}${t['addr:housenumber'] ? ' ' + t['addr:housenumber'] : ''}` : '';
      pois.push([t.name, r5(lat), r5(lon), categoryOf(t), street]);
    }
  } else if (t['addr:street'] && t['addr:housenumber']) {
    addresses.push([t['addr:street'], t['addr:housenumber'], r5(lat), r5(lon)]);
  }
}

const streets = [];
for (const [name, pts] of streetPts) {
  // punct reprezentativ: cel mai apropiat de centrul de greutate
  let la = 0, lo = 0;
  for (const p of pts) { la += p[0]; lo += p[1]; }
  la /= pts.length; lo /= pts.length;
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = (p[0] - la) ** 2 + (p[1] - lo) ** 2; if (d < bd) { bd = d; best = p; } }
  streets.push([name, r5(best[0]), r5(best[1])]);
}

const out = {
  city: city.name,
  generated: new Date().toISOString(),
  source: '© OpenStreetMap contributors (ODbL)',
  bbox: city.bbox,
  coords, edges, names, streets, pois, addresses, taxiStands,
};
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/city-map.json', import.meta.url), JSON.stringify(out));
console.log(`Gata: ${coords.length / 2} noduri, ${edges.length / 4} segmente, ${streets.length} străzi, ${pois.length} locuri, ${addresses.length} adrese, ${taxiStands.length} stații taxi.`);
