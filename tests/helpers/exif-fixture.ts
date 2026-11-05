// Builds the smallest JPEG that carries a GPS location, so tests don't need a binary fixture file.

function rational(view: DataView, offset: number, numerator: number, denominator: number) {
  view.setUint32(offset, numerator, false);
  view.setUint32(offset + 4, denominator, false);
}

function dms(value: number): [number, number, number] {
  const size = Math.abs(value);
  const degrees = Math.floor(size);
  const minutes = Math.floor((size - degrees) * 60);
  const seconds = Math.round(((size - degrees) * 60 - minutes) * 60 * 10000);
  return [degrees, minutes, seconds];
}

export function jpegWithGps(lat: number, lng: number): Uint8Array<ArrayBuffer> {
  // TIFF, big-endian: header, IFD0 with a pointer to the GPS IFD, then the GPS IFD and its values.
  const tiff = new DataView(new ArrayBuffer(128));
  tiff.setUint16(0, 0x4d4d, false); // MM
  tiff.setUint16(2, 42, false);
  tiff.setUint32(4, 8, false); // IFD0 at 8

  tiff.setUint16(8, 1, false); // one entry
  tiff.setUint16(10, 0x8825, false); // GPSInfo
  tiff.setUint16(12, 4, false); // LONG
  tiff.setUint32(14, 1, false);
  tiff.setUint32(18, 26, false); // GPS IFD at 26
  tiff.setUint32(22, 0, false);

  const entry = (index: number, tag: number, type: number, count: number, value: number) => {
    const at = 28 + index * 12;
    tiff.setUint16(at, tag, false);
    tiff.setUint16(at + 2, type, false);
    tiff.setUint32(at + 4, count, false);
    tiff.setUint32(at + 8, value, false);
  };
  const ascii = (letter: string) => letter.charCodeAt(0) * 0x1000000;

  tiff.setUint16(26, 4, false); // four entries, ending at 76
  entry(0, 1, 2, 2, ascii(lat >= 0 ? 'N' : 'S'));
  entry(1, 2, 5, 3, 80);
  entry(2, 3, 2, 2, ascii(lng >= 0 ? 'E' : 'W'));
  entry(3, 4, 5, 3, 104);
  tiff.setUint32(76, 0, false);

  const [latD, latM, latS] = dms(lat);
  rational(tiff, 80, latD, 1);
  rational(tiff, 88, latM, 1);
  rational(tiff, 96, latS, 10000);
  const [lngD, lngM, lngS] = dms(lng);
  rational(tiff, 104, lngD, 1);
  rational(tiff, 112, lngM, 1);
  rational(tiff, 120, lngS, 10000);

  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const segmentLength = 2 + exifHeader.length + tiff.byteLength;
  return new Uint8Array([
    0xff, 0xd8, // start of image
    0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff,
    ...exifHeader,
    ...new Uint8Array(tiff.buffer),
    0xff, 0xd9, // end of image
  ]);
}

// A valid 1x1 PNG with no metadata.
export const PLAIN_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);
