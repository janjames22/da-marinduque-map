import { describe, expect, it } from 'vitest';
import { photoProblem, readPhotoMeta } from '../src/modules/intervention-map/lib/photo-meta';
import { jpegWithGps, PLAIN_PNG } from './helpers/exif-fixture';

describe('readPhotoMeta', () => {
  it('reads the location from a geotagged JPEG', async () => {
    const { exif_location } = await readPhotoMeta(new Blob([jpegWithGps(13.4671, 122.0686)], { type: 'image/jpeg' }));
    expect(exif_location?.lat).toBeCloseTo(13.4671, 4);
    expect(exif_location?.lng).toBeCloseTo(122.0686, 4);
  });

  it('reads south and west as negative', async () => {
    const { exif_location } = await readPhotoMeta(new Blob([jpegWithGps(-13.5, -122.25)], { type: 'image/jpeg' }));
    expect(exif_location?.lat).toBeCloseTo(-13.5, 4);
    expect(exif_location?.lng).toBeCloseTo(-122.25, 4);
  });

  it('finds nothing in a photo with no location', async () => {
    expect(await readPhotoMeta(new Blob([PLAIN_PNG], { type: 'image/png' }))).toEqual({ exif_location: null, taken_at: null });
  });

  it('finds nothing in a file that isn\'t really a photo', async () => {
    expect(await readPhotoMeta(new Blob(['not an image'], { type: 'image/jpeg' }))).toEqual({ exif_location: null, taken_at: null });
  });
});

describe('photoProblem', () => {
  it('accepts an image within the size limit', () => {
    expect(photoProblem(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBeNull();
  });

  it('rejects other files and oversized photos', () => {
    expect(photoProblem(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toContain('image');
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.jpg', { type: 'image/jpeg' });
    expect(photoProblem(big)).toContain('10 MB');
  });
});
