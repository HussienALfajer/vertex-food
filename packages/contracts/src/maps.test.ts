import { describe, expect, it } from 'vitest';
import {
  coordinatesFromMapUrl,
  degreesToE7,
  isInServiceRegion,
  isMapLinkHost,
  parseCoordinatesText,
} from './maps.js';

// Synthetic points around Azaz; no real address.
const point = { latitudeE7: 365_876_000, longitudeE7: 370_448_000 };

describe('degreesToE7', () => {
  it('converts without floating point and rounds the eighth decimal', () => {
    expect(degreesToE7('36.5876')).toBe(365_876_000);
    expect(degreesToE7('-0.00000005')).toBe(-1);
    expect(degreesToE7('37.12345674')).toBe(371_234_567);
    expect(degreesToE7('37')).toBe(370_000_000);
    expect(degreesToE7('1e3')).toBeUndefined();
  });
});

describe('parseCoordinatesText', () => {
  it.each(['36.5876, 37.0448', '36.5876,37.0448', ' 36.5876 37.0448 ', '٣٦٫٥٨٧٦، ٣٧٫٠٤٤٨'])(
    'reads %j',
    (text) => {
      expect(parseCoordinatesText(text)).toEqual(point);
    },
  );

  it.each(['', '36.5876', '91, 37', '36.5, 181', 'Azaz', '36.5876, 37.0448, 3'])(
    'refuses %j',
    (text) => {
      expect(parseCoordinatesText(text)).toBeUndefined();
    },
  );
});

describe('coordinatesFromMapUrl', () => {
  it.each([
    'https://www.google.com/maps/place/X/@36.5,37.0,17z/data=!3d36.5876!4d37.0448',
    'https://www.google.com/maps/@36.5876,37.0448,17z',
    'https://www.google.com/maps?q=36.5876,37.0448',
    'https://maps.google.com/?ll=36.5876,37.0448&z=16',
    'https://www.google.com/maps/search/?api=1&query=36.5876%2C37.0448',
    'https://www.openstreetmap.org/?mlat=36.5876&mlon=37.0448#map=17/36.5/37.0',
    'https://www.openstreetmap.org/#map=17/36.5876/37.0448',
  ])('reads %s', (url) => {
    expect(coordinatesFromMapUrl(url)).toEqual(point);
  });

  it.each([
    'https://evil.example/maps/@36.5876,37.0448,17z',
    'https://google.com.evil.example/maps?q=36.5876,37.0448',
    'https://www.google.com/maps/place/Azaz',
    'ftp://www.google.com/maps?q=36.5876,37.0448',
    'not a url',
  ])('refuses %s', (url) => {
    expect(coordinatesFromMapUrl(url)).toBeUndefined();
  });

  it('allows only the listed hosts', () => {
    expect(isMapLinkHost('maps.app.goo.gl')).toBe(true);
    expect(isMapLinkHost('MAPS.APP.GOO.GL')).toBe(true);
    expect(isMapLinkHost('127.0.0.1')).toBe(false);
    expect(isMapLinkHost('google.com.tr.example')).toBe(false);
  });
});

describe('isInServiceRegion', () => {
  it('knows Syria and Turkey and asks to confirm points elsewhere', () => {
    expect(isInServiceRegion(point)).toBe(true);
    expect(isInServiceRegion({ latitudeE7: 410_082_000, longitudeE7: 289_784_000 })).toBe(true);
    expect(isInServiceRegion({ latitudeE7: 0, longitudeE7: 0 })).toBe(false);
  });
});
