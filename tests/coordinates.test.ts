import { describe, expect, it } from 'vitest';
import { formatPoint, googleMapsUrl, parseCoordinates, roundCoordinate } from '../src/modules/intervention-map/lib/coordinates';

const point = (text: string) => {
  const result = parseCoordinates(text);
  if (!result.ok) throw new Error(`${text}: ${result.error}`);
  return result.point;
};

describe('parseCoordinates', () => {
  it.each([
    ['13.4671, 122.0686', 13.4671, 122.0686],
    ['13.4671,122.0686', 13.4671, 122.0686],
    ['13.4671 122.0686', 13.4671, 122.0686],
    ['  13.4671 ;  122.0686  ', 13.4671, 122.0686],
    ['Lat: 13.4671, Long: 122.0686', 13.4671, 122.0686],
    ['-13.5, -122.25', -13.5, -122.25],
    ['13.4671° 122.0686°', 13.4671, 122.0686],
  ])('reads decimal degrees: %s', (text, lat, lng) => {
    expect(point(text)).toEqual({ lat, lng });
  });

  it.each([
    ['13.4671 N, 122.0686 E'],
    ['N13.4671 E122.0686'],
    ['122.0686 E, 13.4671 N'],
    ['13.4671n 122.0686e'],
  ])('reads decimal degrees with hemisphere letters, in any order: %s', (text) => {
    expect(point(text)).toEqual({ lat: 13.4671, lng: 122.0686 });
  });

  it('turns south and west into negative values', () => {
    expect(point('13.5 S, 122.25 W')).toEqual({ lat: -13.5, lng: -122.25 });
  });

  it.each([
    [`13°28'01.6"N 122°04'07.0"E`],
    [`13° 28' 1.6" N, 122° 4' 7" E`],
    [`13º28’01.6”N 122º04’07.0”E`],
    [`13°28′01.6″N 122°04′07.0″E`],
    [`N 13 28 1.6 E 122 4 7`],
    [`13 28 1.6 N 122 4 7 E`],
    [`13 28 1.6 122 4 7`],
    [`13:28:1.6, 122:4:7`.replaceAll(':', ' ')],
    [`122°04'07.0"E 13°28'01.6"N`],
  ])('reads degrees, minutes and seconds: %s', (text) => {
    const { lat, lng } = point(text);
    expect(lat).toBeCloseTo(13 + 28 / 60 + 1.6 / 3600, 6);
    expect(lng).toBeCloseTo(122 + 4 / 60 + 7 / 3600, 6);
  });

  it('reads degrees and decimal minutes', () => {
    const { lat, lng } = point(`13°28.027'N 122°4.117'E`);
    expect(lat).toBeCloseTo(13 + 28.027 / 60, 6);
    expect(lng).toBeCloseTo(122 + 4.117 / 60, 6);
  });

  it('reads a longitude-first pair when the first value can only be a longitude', () => {
    const result = parseCoordinates('122.0686, 13.4671');
    expect(result).toEqual({ ok: true, point: { lat: 13.4671, lng: 122.0686 }, note: expect.stringContaining('longitude first') });
  });

  it.each([
    ['https://www.google.com/maps/place/Tawiran/@13.4671,122.0686,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d13.4675!4d122.0690', 13.4675, 122.069],
    ['https://www.google.com/maps/@13.4671,122.0686,15z', 13.4671, 122.0686],
    ['https://www.google.com/maps?q=13.4671,122.0686', 13.4671, 122.0686],
    ['https://maps.google.com/?q=13.4671%2C122.0686', 13.4671, 122.0686],
    ['https://www.google.com/maps/search/?api=1&query=13.4671,122.0686', 13.4671, 122.0686],
    ['https://www.google.com/maps/dir/?api=1&destination=13.4671,122.0686', 13.4671, 122.0686],
  ])('reads a Google Maps link, preferring the pin to the view: %s', (url, lat, lng) => {
    expect(point(url)).toEqual({ lat, lng });
  });

  it('explains why a short Google Maps link can\'t be read', () => {
    const result = parseCoordinates('https://maps.app.goo.gl/AbCdEf123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Short links');
  });

  it.each([
    [''],
    ['   '],
    ['13.4671'],
    ['13.4671, 122.0686, 15'],
    ['Tawiran, Santa Cruz'],
    ['13.4671 N, 12.0686 N'],
    ['13.4671 E, 122.0686 W'],
    ['95, 200'],
    ['13, 190'],
    [`13°70'00"N 122°04'07"E`],
    [`13°28'75"N 122°04'07"E`],
    [`13.5°28'N 122°04'E`],
    ['-13.5 N, 122 E'],
    ['https://www.google.com/maps/place/Tawiran'],
  ])('rejects %j instead of guessing', (text) => {
    expect(parseCoordinates(text).ok).toBe(false);
  });

  it('keeps seven decimals', () => {
    expect(roundCoordinate(13.46711111111)).toBe(13.4671111);
    expect(point('13.46711111111, 122.0686')).toEqual({ lat: 13.4671111, lng: 122.0686 });
  });
});

describe('sharing coordinates', () => {
  it('formats a point the way Google Maps reads it back', () => {
    const text = formatPoint({ lat: 13.4671083, lng: 122.06859 });
    expect(text).toBe('13.4671083, 122.06859');
    expect(point(text)).toEqual({ lat: 13.4671083, lng: 122.06859 });
  });

  it('links to Google Maps with latitude first', () => {
    expect(googleMapsUrl({ lat: 13.4671, lng: 122.0686 })).toBe('https://www.google.com/maps?q=13.4671%2C122.0686');
  });
});
