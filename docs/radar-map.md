# Radar map

The results area has a **Grid / Radar map** toggle. Grid is the default. The map shows the same
listings the grid would show, from the same `filteredListings` result in `src/App.tsx`, so city,
filters, sort and pay overrides all carry over when you switch. It opens the same listing dossier
as a card does.

Everything on the map is **illustrative demo data**. The listings are bundled fixtures.

## What the map shows

- **Listing pins.** One per mapped fixture, labeled with its deal score. The tier follows the score
  and nothing else:

  | Score | Pin |
  |---|---|
  | 90 or higher | Green |
  | 75 to 89 | Amber |
  | Below 75, missing, or outside 0 to 100 | Neutral. A missing score reads "unavailable", never green. |

  Savings are shown separately, in the pin's accessible name and in the list. They never change the
  tier.
- **Red city context.** A hollow red diamond at the approximate center of a city whose existing
  `gentrificationRating` is High or Severe. It is context for that rating. It is **not** a
  neighborhood boundary, a verified danger claim, or a listing, and it never changes a pin's color.
  It follows the selected city only: all such cities (seven today) for "All cities", the one
  selected city if it qualifies, and none for Tokyo (Moderate). It ignores the budget, type and
  text filters, and it is left out of the framing and the counts.
- **Scout hits are not plotted.** They have no known position and no deal score, so they stay in
  their own section above the listings.
- **Mapped listings list.** A plain list of buttons under the map. Pins can sit on top of each other
  at a wide zoom, and the list makes every mapped listing selectable by keyboard and touch without
  a clustering library.
- **Omitted listings.** A listing without a valid position is left off the map. The map says how
  many, and Grid still opens them. A valid position is a finite latitude in [-90, 90] and
  longitude in [-180, 180]. (0, 0) is a valid point.

## Framing

| Situation | View |
|---|---|
| A city is selected | That city's center at zoom 10, even with no matching listing. The view resets when the city or map size changes. |
| All cities, several listings | Fits the listing positions, with padding and a zoom cap of 13. |
| All cities, one listing | That position at zoom 13. |
| All cities, no listing | Fits the eight city centers. |
| Unknown city id | Treated like All cities. |

Zoom 10 keeps every fixture on screen in a 320 px wide map. The lowest zoom is 0, because framing
San Francisco to Tokyo on a phone needs it.

When the map's size really changes (a resized window, a rotated phone), the current view is framed
again with no animation, so a fit made for a wide map does not clip pins once it is narrow. That
also resets any pan or zoom you made by hand. A re-render that changes no size or view, such as
opening the dossier or editing a pay figure, leaves the view alone.

## Using it

- A pin is a button. Tab to it, then press Enter or Space. Enter acts on key down and Space on key
  up, like a native button. A click or tap works too.
- Closing the dossier with Escape or Close returns focus to the pin or list button you opened it from.
- The zoom buttons and the keyboard (arrow keys, plus and minus once the map itself has focus) move
  the map. With `prefers-reduced-motion: reduce` the map does not animate zoom, fades, arrow-key
  panning or the slide after a drag. The setting is read when the map is created.
- On touch screens one finger scrolls the page. Two fingers pan and pinch the map, so a swipe that
  starts on the map can still reach the content below it.

## Approximate positions and their sources

Every position is an **approximate demo position, not a property address**. The points are
neighborhood-scale or city-scale. They are not actual homes and not the named station or stop in a
fixture's neighborhood. All positions are distinct, so nothing is jittered.

They live in `src/data/mapCoordinates.ts`, apart from the listing and city data. Each was the top
result of a Nominatim search (`format=jsonv2`, `limit=1`) for the city or neighborhood name on
2026-10-29. `osm` is the OpenStreetMap object that result came from. Open
`https://www.openstreetmap.org/<osm>` to see it. Three results are broad: Teusaquillo is an area,
Jumeirah Lake Towers is an area rather than Cluster V, and the Mission District result is a
locality node rather than the 24th St BART stop.

| City | Latitude, longitude | OSM |
|---|---|---|
| New York City | 40.7127281, -74.0060152 | relation/175905 |
| London | 51.5074456, -0.1277653 | relation/175342 |
| Tokyo | 35.6768601, 139.7638947 | relation/1543125 |
| Bogotá | 4.6533817, -74.0836331 | relation/7426387 |
| Dubai | 25.0742823, 55.1885624 | relation/4479752 |
| Paris | 48.8588897, 2.3200410 | relation/7444 |
| Berlin | 52.5173885, 13.3951309 | relation/62422 |
| San Francisco | 37.7879363, -122.4075201 | relation/111968 |

| Fixture | Neighborhood in the fixture | Latitude, longitude | OSM |
|---|---|---|---|
| nyc-sublet-01 | Bushwick (Morgan L Stop) | 40.6942696, -73.9187482 | way/271286173 |
| nyc-sublet-02 | Ridgewood (Forest Ave M) | 40.7080556, -73.9141667 | way/325933623 |
| london-sublet-01 | Hackney Wick (Zone 2) | 51.5434383, -0.0241542 | node/7147521855 |
| london-sublet-02 | Peckham Rye / Bellenden Road | 51.4700059, -0.0694125 | node/6991125522 |
| bogota-sublet-01 | Chapinero Alto (Calle 58 con 4) | 4.6323244, -74.0632454 | way/371547403 |
| bogota-sublet-02 | Teusaquillo (Parkway) | 4.6286663, -74.0752959 | relation/11502495 |
| tokyo-sublet-01 | Koenji (Chuo Line 6 min) | 35.7049419, 139.6499090 | node/6359428685 |
| berlin-sublet-01 | Neukölln (Weserstraße) | 52.4771133, 13.4535680 | way/881155240 |
| dubai-sublet-01 | Jumeirah Lake Towers (Cluster V) | 25.0723832, 55.1437432 | way/433279682 |
| paris-sublet-01 | Belleville (20th Arrondissement) | 48.8717265, 2.3850850 | relation/2195117 |
| sf-sublet-01 | Mission District (24th St BART) | 37.7599300, -122.4191376 | node/140983158 |

Search ranking can change, so a new lookup may not return the same points.

## Basemap, attribution and availability

- Tiles come from the public OpenStreetMap server at
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. There is no key and no account.
- The map shows "© OpenStreetMap contributors", linked to
  `https://www.openstreetmap.org/copyright`, at the bottom left of the map, away from the fixed
  Copilot button. Map data is © OpenStreetMap contributors under the ODbL. Below 640 px the closed
  Copilot button shows only its icon (its accessible name is unchanged), and the credit stops short
  of that button's column and wraps, so the button never covers the credit at any scroll position.
- The code keeps the tile URL exact and leaves the browser's normal Referer and cache behavior
  alone. It adds no proxy, prefetch, cache-busting query or `Referrer-Policy` change.
  See the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **Availability.** The public tile server is capacity-limited, best effort and has no SLA. The
  OpenStreetMap Foundation may block heavy or abusive use. This is fine for a low-volume demo. A
  service with real traffic needs a tile provider with terms that fit it.
- If tiles fail to load, the map shows a "Basemap tiles are unavailable for some or all of this map"
  notice. It stays up while any failed tile is still on the map. A different tile loading does not
  clear it. It goes when the failed tiles load or leave the map (you pan or zoom away from them).
  The map does not retry tiles itself. Pins, the list and Grid keep working. If the map library
  itself fails to load, the map says so and the list and Grid keep working.
- The basemap is dark through a CSS filter on the tile pane only. Pins, the diamond rings, the zoom
  buttons and the attribution keep their own colors.

## Leaflet

The map uses [Leaflet](https://leafletjs.com) 1.9.4 directly (BSD-2-Clause, © 2010-2023 Volodymyr
Agafonkin, © 2010-2011 CloudMade), with `@types/leaflet` 1.9.22 as a dev dependency. The map keeps
Leaflet's own "Leaflet" credit in its attribution.

The BSD license requires its copyright notice, conditions and disclaimer to travel with the code.
The minified build drops Leaflet's header comment, so the full license text is
`public/leaflet-LICENSE.txt`, a copy of the `LICENSE` file in the installed `leaflet@1.9.4` package.
Vite copies `public/` into the build, so it is served at `/leaflet-LICENSE.txt`, and the map links
to it ("Leaflet license notice"). If you upgrade Leaflet, copy its new `LICENSE` over that file.
The tests fail if the two differ.

Leaflet reads `window` and `document` when its module runs, so it is imported with a dynamic
`import()` from an effect after the map mounts in a browser. Its stylesheet is imported in
`src/main.tsx`. That keeps Leaflet out of the server render that the existing tests use, and the
code is a separate chunk in the production build. The map is unmounted when you switch to Grid.

## Checks

`tests/map-visualization.test.ts` is an offline `node:test` file and runs in CI. It covers
coordinate coverage and validity, tier boundaries (74, 75, 89, 90), the context-marker rule, the
view that is chosen, the tile constants, server rendering, and that Leaflet is only a dynamic import.
It also covers the tile-failure notice rule, framing again after a resize (against a fake map),
the reduced-motion pan wrapper, the shipped Leaflet license, and the contrast of the map's text colors.
CI also compares `dist/leaflet-LICENSE.txt` with `public/leaflet-LICENSE.txt` after the build.

Run it with:

```
node --experimental-strip-types --test tests/map-visualization.test.ts
```

It renders static markup and never loads Leaflet. It does not prove focus, layout, stacking, touch,
tile errors or StrictMode cleanup. Those need a real browser.
