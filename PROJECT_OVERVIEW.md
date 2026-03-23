### Ruter Reisetid – prosjektoversikt

**Kort beskrivelse**

- **Formål**: Proof-of-concept som visualiserer hvor langt du kan reise med kollektivtransport innen en gitt tidsramme (isokron-kart) i Ruter-området, inkludert gang- eller sparkesykkel som "last mile".
- **Stack**: Next.js (app router), React, TypeScript, MapLibre GL, Entur API-er (stedsøk + reiseplanlegger), Targomo (isokroner), egen font via `next/font/local` og genererte glyphs.

**Hovedflyt i brukeropplevelsen**

- **Startside (`Home` i `src/app/page.tsx`)**:
  - Viser et fullskjerms MapLibre-kart (`MapView`) med et "glass" panel på toppen.
  - Panelet inneholder:
    - `SearchBar` koblet mot Entur Geocoder / autocomplete for å finde steder.
    - En knapp for å bruke geolokasjon ("Min posisjon").
    - `TimeSelector` for å velge kollektivtid (minutter) + last mile (gang / sparkesykkel, i minutter).
  - Når brukeren velger et punkt (søker, klikker i kartet eller bruker geolokasjon) oppdateres `location`-state, og det trigges isokronberegning mot backend-API.
  - Et loading-overlay og en liten ferry-warning-toast gir visuell feedback ved lange kall og hvis posisjonen er utenfor Oslofjord-området hvor ferge-POC-en gjelder.

- **Kartet (`MapView` i `src/components/Map.tsx`)**:
  - Henter Carto Voyager GL-style, men overskriver `glyphs` til å bruke prosjektets egen `/api/fonts/{fontstack}/{range}.pbf`-proxy slik at TID‑fonten brukes i kartet.
  - Viser:
    - Isokron-geometri (GeoJSON polygon) som grønn "blære" rundt valgt punkt.
    - Klynget visning av stopp (Entur `StopPlace`) med kompositt-badger per transportmodus (metro, tram, bus, rail, water, coach) og navnsetiketter ved høy zoom.
    - En draggable pin for valgt posisjon (kartklikk + drag-and-drop).
  - På `moveend`-events spør kartet backend om nye holdeplasser rundt kartets senter og bygger egne GeoJSON-features for modes per stopp.

**Datakilder og API-er**

- **Targomo (isokroner)**:
  - Frontend bruker `getIsochrone` i `src/lib/targomo.ts` som kaller lokal `/api/isochrone`-route via `fetch`.
  - API-route `src/app/api/isochrone/route.ts`:
    - Leser inn parametere: `lat`, `lng`, `transitMinutes`, `walkMinutes`, `lastMileMode`.
    - Regner om til sekunder og bygger en `maxEdgeWeight` som er summen av transit-tid + last-mile-tid (evt. kun last mile hvis transit = 0).
    - Modellering av sparkesykkel: tolker valgt "gangtid" som budsjett, men ganger det opp med 3× for Targomo slik at man når lenger, uten å endre total-tiden som vises i UI-et.
    - Bruker alltid en transit-frame på 45 minutter rundt kl. 16:00 neste ukedag (ettermiddagsrush) for å modellere at brukeren kan velge beste avgang innen et vindu.

- **Entur (holdeplasser + reiseplanlegger + geocoder)**:
  - `src/lib/entur-stops.ts`:
    - `getNearbyStops(lat, lng, distance)` gjør et GraphQL-kall til Entur Journey Planner `nearest` med filter `stopPlace`.
    - Returnerer en liste av `Stop`-objekter med sortert `modes`-array (metro/rail/tram/water/bus i prioritert rekkefølge).
  - `src/components/SearchBar.tsx`:
    - Bruker Entur Geocoder `/geocoder/v1/autocomplete` for fri-tekst-søk på sted/stopper, med debounce.
    - Ved valg konverteres GeoJSON-koordinater til `{ lat, lng, name }` og sendes til parent (`Home`).
  - `src/lib/entur-ferry.ts`:
    - Dekker hull i Targomo for norske ferger (typisk Oslofjord-øyer og Nesodden).
    - Har en hardkodet liste `OSLO_FERRY_STOPS` med koordinater for sentrale fergeterminaler.
    - For hver kandidat-stopp brukes Entur Journey Planner `trip` for å finne faktisk rute med `mode === "water"` og varighet i sekunder.
    - `getReachableFerryStops` filtrerer:
      - Utgangspunkt utenfor Oslofjord-bounding box.
      - Total budsjett som er for lavt til å realistisk nå noen ferge.
      - Ruter som ikke har ferge-leg eller som overskrider total-budsjett.
    - Returnerer kun fergeterminaler som er nåbare innen budsjettet, med `tripSeconds` inkludert.
  - `/api/isochrone` bruker disse ferge-dataene til å trigge sekundære Targomo-kall fra fergeterminalene (se under).

- **Ferge-augmentering av isokroner**

- **Problem**: Targomo mangler enkelte norske ferger, slik at områder som Nesodden og Oslofjord-øyer kan falle utenfor selv om de reelt er tilgjengelige.
- **Løsning i prosjektet**:
  - 1) Hovedkall: standard Targomo-polygon fra brukerens posisjon med total-budsjett (transit + last mile).
  - 2) Parallelt kall til `getReachableFerryStops` (Entur) som finner hvilke Oslofjord-fergeterminaler som er nåbare innen samme budsjett og faktisk inkluderer vann-legs.
  - 3) For hver slik terminal:
    - Tester om det gjenstår minst 10 minutter av budsjettet etter fergeturen.
    - Kjører sekundære Targomo-kall (`ferryTerminalPolygon`) fra terminalens koordinater, med `remainingSeconds` + samme last-mile-budsjett og transit-frame forskjøvet til ankomsttid (16:00 + reisetid).
  - 4) Alle features fra disse ekstra kallene merges inn i hovedpolygonet før svaret sendes tilbake til frontend.

**State-håndtering og ytelse**

- **Debounce av isokronkall**:
  - I `Home` brukes en `fetchDebounceRef`:
    - Kartklikk / ny lokasjon → kall Targomo umiddelbart.
    - Endring av tid / modus → venter ~400 ms før kall for å unngå storm av API-kall når brukeren slider/klikker.

- **Stopps-cache**:
  - `stopsCacheRef` (Map over `Stop`-objekter) i `Home` fungerer som akkumulerende cache per `id`.
  - Ved `onViewChange` (kart-pan/zoom) hentes nye stopp i radius (standard 8000 m) via `getNearbyStops`.
  - Nye stopp merges inn i cachen; tidligere stopp beholdes slik at man ikke "mister" holdeplasser ved pan, og kartet får etter hvert et rikere datasett.

- **Loading- og toast-animasjoner**:
  - `loading` styrer logikk, mens `loadingVisible` og `loadingLeaving` styrer visuell overlay for smooth intro/outro og for å slippe overlay ved kjappe svar.
  - `ferryWarning` og `ferryLeaving` + timere styrer en auto-dismissed varselboble når brukeren er utenfor Østlandet / Oslofjord-området (fergeantakelser gjelder ikke).

**UI og design**

- **Layout (`RootLayout` i `src/app/layout.tsx`)**:
  - Definerer lokal TID-font via `next/font/local` med variabel `--font-tid`.
  - Setter `viewport`-metadata for PWA-lignende følelse på mobil (fullskjerm, `viewportFit: "cover"`, Apple web app-metadata).
  - Bruker norsk språk (`<html lang="no">`).

- **Komponenter**:
  - `SearchBar`: minimalistisk søkefelt med ikon, autocomplete-liste i `Card`, og håndtering av klikk utenfor for å lukke.
  - `TimeSelector`: liten "kontrollstripe" med:
    - Select for kollektiv-minutter (0–60).
    - Toggle mellom gange og sparkesykkel med egen liten switch-komponent med ikoner.
    - Select for last-mile-minutter.
    - Viser total reisetid i minutter på større skjermer.
  - `MapView`: ansvarlig for MapLibre-setup, lag for isokroner, stopp og klynger.
  - `Card`, `Input`, `Select`: gjenbrukbare UI-byggesteiner (shadcn-inspirert / Base UI) brukt i søk og dropdowns.

**Hvordan komme raskt "up to speed" senere**

- **Hvis du bare får denne filen**:
  - Vit at:
    - `src/app/page.tsx` er hovedsiden og den beste inngangen for å forstå UX-flow og state.
    - `src/app/api/isochrone/route.ts` + `src/lib/entur-ferry.ts` + `src/lib/targomo.ts` forklarer hele reise-logikken og modelleringen av tid + ferge-augmentering.
    - `src/lib/entur-stops.ts` og `src/components/Map.tsx` viser hvordan stopp hentes, caches og tegnes.
  - Endringer i reiselogikk gjøres typisk i `/api/isochrone` + `entur-ferry` + frontend-parameterne i `Home`.
  - Endringer i utseende/UX gjøres hovedsakelig i `page.tsx`, `Map.tsx`, og UI-komponentene i `src/components`.

