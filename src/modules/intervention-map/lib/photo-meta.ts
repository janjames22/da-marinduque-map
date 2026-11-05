import type { PhotoMeta } from '../data/store';
import { roundPoint } from './coordinates';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

// Reads the location and date a camera stored in the photo. Most photos don't carry a location,
// and some phones remove it when a photo is picked, so finding none is a normal result.
export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  const { default: exifr } = await import('exifr/dist/lite.esm.mjs');
  try {
    const tags = await exifr.parse(new Uint8Array(await file.arrayBuffer()), { gps: true });
    const { latitude, longitude, DateTimeOriginal: taken } = tags ?? {};
    return {
      exif_location:
        Number.isFinite(latitude) && Number.isFinite(longitude) ? roundPoint({ lat: latitude, lng: longitude }) : null,
      taken_at: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null,
    };
  } catch {
    return { exif_location: null, taken_at: null }; // not a format that holds this information
  }
}

export function photoProblem(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Choose an image file.';
  if (file.size > MAX_PHOTO_BYTES) return 'That photo is over 10 MB. Choose a smaller one.';
  return null;
}
