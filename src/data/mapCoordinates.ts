// Approximate positions for the Radar Map, kept apart from the listing and city data so no address-like
// field lands on a Listing. Every point is a neighborhood-scale or city-scale demo position, not a
// property address, not an actual home, and not the named station or stop in a fixture neighborhood.
//
// Provenance: the top result of the official Nominatim search (https://nominatim.openstreetmap.org)
// for each city and fixture neighborhood name, queried on 2026-10-29 with format=jsonv2 and limit=1.
// `osm` is the OpenStreetMap object that result came from, as type/id, so a reader can open
// https://www.openstreetmap.org/<osm> to see what the point stands for. Some results are broad:
// Teusaquillo is an area point, Jumeirah Lake Towers is an area point rather than Cluster V, and the
// Mission District is a locality node rather than the 24th St BART stop. Data (c) OpenStreetMap
// contributors, ODbL (https://www.openstreetmap.org/copyright). Details are in docs/radar-map.md.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface MapPosition extends GeoPoint {
  /** The OpenStreetMap object the lookup returned, as type/id. */
  osm: string;
}

export const APPROXIMATE_POSITION_NOTICE = 'Approximate demo position, not a property address';

/** City-center context points, keyed by City.id. */
export const CITY_POSITIONS: Readonly<Record<string, MapPosition>> = {
  nyc: { lat: 40.7127281, lng: -74.0060152, osm: 'relation/175905' },
  london: { lat: 51.5074456, lng: -0.1277653, osm: 'relation/175342' },
  tokyo: { lat: 35.6768601, lng: 139.7638947, osm: 'relation/1543125' },
  bogota: { lat: 4.6533817, lng: -74.0836331, osm: 'relation/7426387' },
  dubai: { lat: 25.0742823, lng: 55.1885624, osm: 'relation/4479752' },
  paris: { lat: 48.8588897, lng: 2.320041, osm: 'relation/7444' },
  berlin: { lat: 52.5173885, lng: 13.3951309, osm: 'relation/62422' },
  sf: { lat: 37.7879363, lng: -122.4075201, osm: 'relation/111968' },
};

/** Neighborhood-scale demo positions for the bundled fixtures, keyed by Listing.id. */
export const LISTING_POSITIONS: Readonly<Record<string, MapPosition>> = {
  // Bushwick (Morgan L Stop)
  'nyc-sublet-01': { lat: 40.6942696, lng: -73.9187482, osm: 'way/271286173' },
  // Ridgewood (Forest Ave M)
  'nyc-sublet-02': { lat: 40.7080556, lng: -73.9141667, osm: 'way/325933623' },
  // Hackney Wick (Zone 2)
  'london-sublet-01': { lat: 51.5434383, lng: -0.0241542, osm: 'node/7147521855' },
  // Peckham Rye / Bellenden Road
  'london-sublet-02': { lat: 51.4700059, lng: -0.0694125, osm: 'node/6991125522' },
  // Chapinero Alto (Calle 58 con 4)
  'bogota-sublet-01': { lat: 4.6323244, lng: -74.0632454, osm: 'way/371547403' },
  // Teusaquillo (Parkway), a broad area point
  'bogota-sublet-02': { lat: 4.6286663, lng: -74.0752959, osm: 'relation/11502495' },
  // Koenji (Chuo Line 6 min)
  'tokyo-sublet-01': { lat: 35.7049419, lng: 139.649909, osm: 'node/6359428685' },
  // Neukölln (Weserstraße)
  'berlin-sublet-01': { lat: 52.4771133, lng: 13.453568, osm: 'way/881155240' },
  // Jumeirah Lake Towers (Cluster V), an area point
  'dubai-sublet-01': { lat: 25.0723832, lng: 55.1437432, osm: 'way/433279682' },
  // Belleville (20th Arrondissement)
  'paris-sublet-01': { lat: 48.8717265, lng: 2.385085, osm: 'relation/2195117' },
  // Mission District (24th St BART), a locality node
  'sf-sublet-01': { lat: 37.75993, lng: -122.4191376, osm: 'node/140983158' },
};
