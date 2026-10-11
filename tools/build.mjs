// Construiește simulatorul într-un singur fișier (index.html), cu toate cele 3 aplicații incluse.
// Rulează: npm run build   (după orice modificare în js/, css/, config.js sau data/)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const rd = p => readFile(new URL(p, root), 'utf8');
const rdb = p => readFile(new URL(p, root));
const noClose = s => s.replace(/<\/script/gi, '<\\/script');

const b64 = async p => (await rdb(p)).toString('base64');
const fontLatin = await b64('fonts/figtree-latin-wght-normal.woff2');
const fontExt = await b64('fonts/figtree-latin-ext-wght-normal.woff2');
const withFonts = css => css
  .replace("url('../fonts/figtree-latin-wght-normal.woff2')", `url(data:font/woff2;base64,${fontLatin})`)
  .replace("url('../fonts/figtree-latin-ext-wght-normal.woff2')", `url(data:font/woff2;base64,${fontExt})`);

const base = await rd('css/base.css');
const fontFaces = withFonts(base.slice(0, base.indexOf(':root')));

const parts = {
  data: JSON.parse(await rd('data/city-map.json')),
  leaflet: noClose(await rd('vendor/leaflet/leaflet.js')),
  css: {
    common: (await rd('vendor/leaflet/leaflet.css')) + withFonts(base),
    client: await rd('css/client.css'),
    sofer: await rd('css/sofer.css'),
    dispecer: await rd('css/dispecer.css'),
  },
  body: {
    client: '<div id="app"><div id="map" class="map"></div></div>',
    sofer: '<div id="app"></div>',
    dispecer: '',
  },
  js: {},
};
for (const role of ['client', 'sofer', 'dispecer']) {
  const r = await build({ entryPoints: [new URL(`js/${role}.js`, root).pathname], bundle: true, format: 'esm', target: 'es2022', minify: true, write: false, legalComments: 'none' });
  parts.js[role] = noClose(r.outputFiles[0].text);
}

const json = JSON.stringify(parts).replace(/</g, '\\u003c');
const tpl = await rd('tools/simulator.template.html');
const fragment = tpl.replace('/*__FONTS__*/', fontFaces).replace('/*__PARTS__*/', () => json);

// varianta pentru GitHub Pages (document complet)
const full = `<!doctype html>\n<html lang="ro">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#FFC21A">\n<link rel="icon" href="img/icon.svg" type="image/svg+xml">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`;
await writeFile(new URL('index.html', root), full);
// varianta pentru publicare ca artifact (fără schelet)
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/simulator.html', root), fragment);
console.log(`index.html: ${(full.length / 1024).toFixed(0)} KB`);
