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

- **Verde pătrat** – liber, în stație (la coadă)
- **Verde rotund cu săgeată** – liber, pe drum
- **Portocaliu** – merge spre o comandă
- **Albastru** – cu client
- **Gri** – pauză

## Ce conține

**Client:** comandă fără destinație („Vreau taxi aici”) sau cu destinație și preț estimat; adrese salvate (Acasă/Serviciu), istoric; căutare pe străzi, numere și locuri cunoscute din oraș; alegere pe hartă cu pin; plată **cash** sau **card salvat** (se încasează automat la final, cu validare card); opțiuni (portbagaj mare, animal, scaun copil, ajutor la urcare) și mesaj pentru șofer; programare; urmărirea mașinii cu numărul de înmatriculare și timp de sosire; apel prin centrală, mesaje rapide, „Trimite familiei”, buton de ajutor (112 / dispecerat); chitanță și rating; mod **text mare**.

**Șofer:** intrare în tură cu PIN; un singur comutator LIBER / PAUZĂ; locul la coadă în stație; ofertă pe tot ecranul cu sunet, vibrație, numărătoare inversă și citire cu voce; navigare în Waze sau Google Maps dintr-o atingere; pași mari: AM AJUNS (se activează lângă adresă) → CLIENTUL A URCAT → CURSĂ TERMINATĂ; cronometru de așteptare cu minute gratuite; „Clientul nu a venit”; tastatură mare pentru suma de pe taximetru; cash vs card încasat automat; mesaje rapide predefinite; câștiguri pe azi; precomenzi; mod noapte automat; SOS (ține apăsat 2 secunde); funcționează și pe orizontală, în suportul de bord.

**Dispecerat:** KPI-uri live; hartă cu filtre pe stări și numerele mașinilor; formular pentru comenzi telefonice cu recunoașterea clienților după număr; adrese din listă sau click pe hartă; trimitere automată sau alegerea mașinii; detalii comandă cu istoric pe minute; realocare manuală; cozile din stații; alerte (SOS, refuzuri, comenzi fără mașină); SMS simulat către client.

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
