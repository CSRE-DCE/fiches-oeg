/*
 * Calculs géographiques purs (aucune dépendance au DOM ni à l'état de l'application).
 * Projection utilisée : UTM (zone 21N ou 22N), ellipsoïde GRS80/WGS84 — conforme à la
 * projection "RGFG 95 / UTM 22N" utilisée par les fiches terrain OEG.
 *
 * Ce fichier est un vrai module ES (export/import) : il est chargé par l'application via
 * <script type="module"> et importé tel quel par les tests unitaires (tests/geo.test.js).
 */

const A = 6378137;           // demi-grand axe (m)
const E = 0.0818191908426;   // excentricité
const K0 = 0.9996;           // facteur d'échelle UTM

export function utmToLatLon(easting, northing, zone = 22) {
  const e1 = (1 - Math.sqrt(1 - E * E)) / (1 + Math.sqrt(1 - E * E));
  const x = easting - 500000;
  const M = northing / K0;
  const mu = M / (A * (1 - E * E / 4 - 3 * Math.pow(E, 4) / 64 - 5 * Math.pow(E, 6) / 256));
  const J1 = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
  const J2 = 21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32;
  const J3 = 151 * Math.pow(e1, 3) / 96;
  const J4 = 1097 * Math.pow(e1, 4) / 512;
  const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);
  const e2 = E * E / (1 - E * E);
  const C1 = e2 * Math.pow(Math.cos(fp), 2);
  const T1 = Math.pow(Math.tan(fp), 2);
  const N1 = A / Math.sqrt(1 - E * E * Math.pow(Math.sin(fp), 2));
  const R1 = A * (1 - E * E) / Math.pow(1 - E * E * Math.pow(Math.sin(fp), 2), 1.5);
  const D = x / (N1 * K0);
  const lat = fp - (N1 * Math.tan(fp) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * Math.pow(D, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2 - 3 * C1 * C1) * Math.pow(D, 6) / 720
  );
  const lon0 = (zone * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * Math.pow(D, 5) / 120
  ) / Math.cos(fp);
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

export function latLonToUtm(lat, lon, zone = 22) {
  const rad = Math.PI / 180;
  const phi = lat * rad;
  const lam = lon * rad;
  const l0 = (zone * 6 - 183) * rad;
  const N = A / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = (E * E / (1 - E * E)) * Math.cos(phi) ** 2;
  const Aa = Math.cos(phi) * (lam - l0);
  const M = A * (
    (1 - E * E / 4 - 3 * E ** 4 / 64 - 5 * E ** 6 / 256) * phi
    - (3 * E * E / 8 + 3 * E ** 4 / 32 + 45 * E ** 6 / 1024) * Math.sin(2 * phi)
    + (15 * E ** 4 / 256 + 45 * E ** 6 / 1024) * Math.sin(4 * phi)
    - (35 * E ** 6 / 3072) * Math.sin(6 * phi)
  );
  const easting = K0 * N * (
    Aa
    + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * E * E / (1 - E * E)) * Aa ** 5 / 120
  ) + 500000;
  const northing = K0 * (
    M
    + N * Math.tan(phi) * (
      Aa * Aa / 2
      + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * E * E / (1 - E * E)) * Aa ** 6 / 720
    )
  );
  return [easting, northing];
}

export function ecartGPS(xTheorique, yTheorique, xTerrain, yTerrain) {
  return Math.hypot(xTerrain - xTheorique, yTerrain - yTheorique);
}

if (typeof window !== 'undefined') {
  window.utmToLatLon = utmToLatLon;
  window.latLonToUtm = latLonToUtm;
  window.ecartGPS = ecartGPS;
}
