# Taxi App – client, șofer și dispecerat

Demo complet, interactiv, al unei aplicații de taxi pentru un oraș mic sau mijlociu (configurat acum pentru **Turda**, sub numele demo **Arieș Taxi**). Rulează direct în browser, pe telefon sau calculator, fără instalare.

| Pagina | Pentru cine | Ce face |
|---|---|---|
| `index.html` | prezentare | **Simulatorul**: cele 3 aplicații rulează live în aceeași pagină, cu taburi Client / Șofer / Dispecerat / Toate 3 |
| `client.html` | clienți | Comandă dintr-o atingere, preț estimat, urmărire mașină, cash sau card |
| `sofer.html` | șoferi | Butoane mari, ofertă pe tot ecranul, citire cu voce, coadă în stație |
| `dispecer.html` | dispecerat | Flota live pe hartă, comenzi telefonice, alocare manuală, alerte |

## Cum testezi în 1 minut

1. Deschide `sofer.html`, apasă **Demo** apoi **Intră în tură** (PIN `1234`).
2. În alt tab deschide `client.html`, apasă **Continuă**, apoi **Vreau taxi aici** → **Comandă taxi**.
3. Comanda sună în tab-ul de șofer. Acceptă și urmărește totul și în `dispecer.html`.
4. În dispecerat poți grăbi timpul (x2 / x5 / x10) ca o cursă să dureze câteva secunde.

Toate tab-urile deschise în același browser se sincronizează live. Celelalte 15 mașini sunt simulate și circulă pe **străzile reale** ale orașului (date OpenStreetMap), primesc comenzi, merg la clienți și stau la coadă în stații.

## Culorile de pe hartă (aceleași în toate aplicațiile)

Fiecare mașină e o mașinuță de taxi văzută de sus, cu lampa TAXI galbenă pe plafon și caroseria în culoarea stării:

- **Verde** – liber (în stație sau pe drum)
- **Mov** – merge spre o comandă
- **Roșu** – cu client
- **Gri transparent, contur punctat** – în pauză („mașină fantomă”)

## Ce conține

**Client**
- Panoul de jos se coboară (trage de bară sau apasă săgeata) ca să vezi toată harta live.
- Atingi orice mașină: indicativ, mașină, număr, șofer, recenzii, dotări și starea ei. Dacă e liberă: „Cere cursă cu acest șofer”. Dacă e în pauză: „Programează cu el când își termină pauza”.
- Rute salvate: Rute salvate → alegi ruta → cash/card → glisezi taxiul spre dreapta. Trei atingeri și o glisare.
- „Mai multe opțiuni”: scaun copil, portbagaj mare, ajutor la urcare, animal. Mașinile dotate primesc comanda primele.
- După comandă: cronometru „Aștepți de…”. Când acceptă șoferul: popup cu poza, indicativul, numărul, recenziile și butoanele „Urmărește comanda” / „Distribuie cursa”.
- Distribuie cursa: apropiatul vede mașina, șoferul, indicativul, ora comenzii, traseul planificat și traseul parcurs.
- SOS în timpul cursei: alertează dispeceratul, iar telefonul șoferului începe să transmită audio.
- La final: bacșiș 5 / 10 / 15 / 20% sau altă sumă (cu cardul chiar dacă ai plătit cash), stele și recenzie.
- Programări până la 14 zile înainte; un șofer o poate prelua din timp și primești confirmarea.
- Chat și apel (prin centrală, numerele rămân private), poză de profil, text mare.

**Șofer**
- Panoul cu LIBER / PAUZĂ se coboară ca să vezi harta.
- Pauză cu durată (5–45 min sau „până revin”), prelungire, aviz la final; pe hartă apare ca mașină fantomă.
- Cereri programate de la clienți (ex. când e în pauză): Accept / Refuz / Mesaj / Sună.
- Comanda nouă arată profilul clientului (poză, stele, recenzii de la alți șoferi), indicațiile lui, mini-hartă cu locul exact și drumul până acolo.
- Cea mai rapidă rută cu trafic live (străzile aglomerate pe hartă cu portocaliu / roșu).
- Chat liber + mesaje rapide, apel cu clientul, mesaje de la dispecerat (citite cu voce).
- La final evaluează clientul (stele, etichete, recenzie). Vede bacșișul primit.
- Precomenzi: preia din timp curse programate.

**Dispecerat** (îmbunătățit după cum lucrează programele profesionale de dispecerat)
- Apel intrare cu recunoașterea clientului și „Comandă din nou” (ultima rută dintr-un click).
- Timer pe comenzile nealocate (portocaliu după 1 min, roșu după 2 min), comenzi urgente.
- Alocare după dotări, rezervarea șoferilor pentru precomenzi, anulare cu motiv.
- Incidente SOS cu audio live din mașină, urmărire pe hartă, apel șofer/client, „Rezolvat”.
- Mesaje către un șofer sau către toți, cu mesaje gata scrise.
- Căutare după telefon, indicativ, număr sau adresă (util și pentru obiecte uitate).
- Strat de trafic pe hartă, scurtătură F2 pentru comandă nouă.

## Simulatorul (`index.html`)

E generat automat din codul aplicațiilor, într-un singur fișier care merge oriunde (GitHub Pages, artifact, atașat pe e-mail). După orice modificare în `js/`, `css/`, `config.js` sau `data/`, rulează:

```
npm install
npm run build
```

## Adaptare pentru altă firmă sau alt oraș

1. **`config.js`** – numele firmei, culoarea de brand, telefonul dispeceratului, tarifele, stațiile, flota, centrul orașului.
2. **`tools/city.json`** – numele orașului și zona (`bbox`: sud, vest, nord, est).
3. Pe GitHub: **Actions → „Date hartă (OpenStreetMap)” → Run workflow**. Străzile, adresele, locurile cunoscute și stațiile de taxi ale noului oraș se descarcă automat în `data/city-map.json` (rulează și singur când modifici `tools/city.json`).

Nimic altceva nu trebuie modificat.

## Publicare (GitHub Pages)

Repo → **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save**. După un minut aplicația e la `https://batranutd.github.io/Taxi-app/`.

Clientul și șoferul pot fi instalate pe telefon din browser („Adaugă pe ecranul principal”).

## Ce e demo și ce trebuie pentru producție

| În demo | În producție |
|---|---|
| Sincronizare între tab-uri (`js/bus.js`, BroadcastChannel) | Server cu WebSocket (ex. pe VPS) – se înlocuiește doar `js/bus.js` |
| Mașinile se mișcă simulat pe străzi | Poziția GPS reală trimisă din telefonul șoferului |
| Plata cu cardul e doar vizuală | Procesator de plăți (ex. Netopia, Stripe) cu tokenizare și pre-autorizare |
| Apelurile și SMS-urile sunt simulate | Apel mascat / SMS printr-un furnizor (ex. Twilio, Vonage) |
| Hartă CARTO (gratuită pentru uz limitat) | Abonament la un furnizor de hărți – se schimbă doar URL-ul în `config.js` |
| Tarife orientative | Tarifele aprobate de primărie; suma finală rămâne cea de pe taximetru |

## Structura

```
config.js            ← tot ce ține de firmă și oraș
index.html, client.html, sofer.html, dispecer.html, demo.html
css/                 ← stiluri (base = culori și componente comune)
js/geo.js            ← graful de străzi, rutare A*, căutare adrese
js/sim.js            ← motorul flotei: stări, comenzi, alocare, stații, tarifare
js/bus.js            ← sincronizarea în timp real între ecrane
js/mapview.js        ← harta și mașinile animate (Leaflet)
js/client.js, js/sofer.js, js/dispecer.js
data/city-map.json   ← străzile orașului (generat automat)
tools/               ← generatorul de date hartă
vendor/leaflet, fonts/
```

Date hartă © OpenStreetMap contributors (ODbL). Leaflet © Volodymyr Agafonkin (BSD-2). Font Figtree (OFL).
