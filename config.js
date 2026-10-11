// =====================================================================
//  CONFIGURARE FIRMĂ / ORAȘ
//  Tot ce se schimbă când vinzi aplicația altei firme sau în alt oraș
//  se află în acest fișier. Restul codului nu trebuie atins.
//  Pentru alt oraș: schimbă și tools/city.json (bbox) și rulează
//  workflow-ul "Date hartă" din GitHub → Actions.
// =====================================================================
export const CONFIG = {
  company: {
    name: 'Arieș Taxi',            // numele afișat peste tot
    short: 'Arieș',
    tagline: 'Taxiul tău din Turda, într-o atingere',
    dispatchPhone: '0264 000 000', // număr dispecerat (fictiv în demo)
    dispatchPhoneShort: '9400',
    email: 'contact@exemplu.ro',
    platePrefix: 'CJ',
  },

  // Culorile de brand (restul culorilor sunt ale stărilor și nu se schimbă)
  brand: {
    accent: '#FFC21A',     // galben taxi
    accentInk: '#1A1405',  // text pe galben
  },

  city: {
    name: 'Turda',
    county: 'Cluj',
    center: [46.5703, 23.7905],
    zoom: 14,
    timezone: 'Europe/Bucharest',
  },

  // Tarife (lei). Valori orientative pentru demo – se pun cele aprobate de primărie.
  tariff: {
    currency: 'lei',
    start: 4.0,          // pornire
    perKmDay: 3.5,       // 06:00 – 22:00
    perKmNight: 3.99,    // 22:00 – 06:00
    perMinWait: 0.8,     // staționare / așteptare
    freeWaitMin: 3,      // minute gratuite la adresă
    minFare: 10,
  },

  // Stațiile de taxi. Primele 4 au coordonatele reale din OpenStreetMap,
  // celelalte sunt puncte uzuale (se ajustează cu firma).
  stations: [
    { id: 'centru',   name: 'Centru',          hint: 'Piața Republicii',     lat: 46.57124, lon: 23.78786 },
    { id: 'potaissa', name: 'Potaissa',        hint: 'Hotel Potaissa',       lat: 46.57401, lon: 23.78490 },
    { id: 'autogara', name: 'Autogară',        hint: 'Str. Ștefan cel Mare', lat: 46.56622, lon: 23.78109 },
    { id: 'salina',   name: 'Salina',          hint: 'Intrarea Durgău',      lat: 46.58558, lon: 23.76065 },
    { id: 'spital',   name: 'Spital',          hint: 'Spitalul Municipal',   lat: 46.57860, lon: 23.77760 },
    { id: 'kaufland', name: 'Kaufland',        hint: 'Calea Victoriei',      lat: 46.56030, lon: 23.81700 },
    { id: 'oprisani', name: 'Oprișani',        hint: 'Micro I',              lat: 46.55760, lon: 23.80150 },
  ],

  // Hartă. Pentru producție comercială se folosește un furnizor cu abonament
  // (ex. MapTiler, Stadia, CARTO Enterprise) – doar se schimbă URL-ul aici.
  map: {
    tiles: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    tilesDark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    dataUrl: 'data/city-map.json',
  },

  // Flota demo
  fleet: [
    { driver: 'Ion Popescu',      model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 07 ARI', rating: 4.9, years: 12, human: true },
    { driver: 'Vasile Moldovan',  model: 'Skoda Octavia',   color: 'galbenă', plate: 'CJ 12 TRD', rating: 4.8, years: 21 },
    { driver: 'Gheorghe Pop',     model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 19 ARI', rating: 4.7, years: 30 },
    { driver: 'Mihai Rus',        model: 'Toyota Corolla',  color: 'galbenă', plate: 'CJ 23 TXI', rating: 4.9, years: 6 },
    { driver: 'Ana Crișan',       model: 'Dacia Jogger',    color: 'galbenă', plate: 'CJ 31 ARI', rating: 5.0, years: 4, big: true },
    { driver: 'Dorin Mureșan',    model: 'VW Passat Combi', color: 'galbenă', plate: 'CJ 34 TRD', rating: 4.6, years: 17, big: true },
    { driver: 'Ioan Câmpean',     model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 40 ARI', rating: 4.8, years: 25 },
    { driver: 'Florin Bodea',     model: 'Skoda Octavia',   color: 'galbenă', plate: 'CJ 45 TXI', rating: 4.7, years: 9 },
    { driver: 'Radu Oltean',      model: 'Toyota Corolla',  color: 'galbenă', plate: 'CJ 52 ARI', rating: 4.9, years: 14 },
    { driver: 'Nicolae Szabo',    model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 58 TRD', rating: 4.8, years: 33 },
    { driver: 'Cristian Man',     model: 'Hyundai Elantra', color: 'galbenă', plate: 'CJ 63 ARI', rating: 4.6, years: 3 },
    { driver: 'Marius Todea',     model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 67 TXI', rating: 4.9, years: 19 },
    { driver: 'Liviu Pop',        model: 'Skoda Superb',    color: 'galbenă', plate: 'CJ 71 ARI', rating: 4.8, years: 11 },
    { driver: 'Zoltan Kovács',    model: 'Toyota Corolla',  color: 'galbenă', plate: 'CJ 77 TRD', rating: 4.7, years: 22 },
    { driver: 'Sorin Avram',      model: 'Dacia Logan',     color: 'galbenă', plate: 'CJ 84 ARI', rating: 4.9, years: 8 },
    { driver: 'Petru Lazăr',      model: 'Dacia Jogger',    color: 'galbenă', plate: 'CJ 88 TXI', rating: 4.8, years: 27, big: true },
  ],

  // Client demo (precompletat ca prezentarea să meargă dintr-un tap)
  demoClient: {
    name: 'Maria Ionescu',
    phone: '0744 123 456',
    home: { label: 'Acasă', address: 'Strada Teilor 2', lat: 46.55766, lon: 23.79949 },
    work: { label: 'Serviciu', address: 'Primăria Turda, Piața 1 Decembrie 1918', lat: 46.56966, lon: 23.78603 },
  },

  // Demo: cât de des apar comenzi „de fundal” ca orașul să pară viu
  demo: {
    backgroundOrdersPerMinute: 0.7,
    offerSecondsHuman: 25,
    avgSpeedKmh: 30,
  },
};
