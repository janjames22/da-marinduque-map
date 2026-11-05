// The lite build covers JPEG and HEIC with EXIF and GPS, at a fraction of the full build's size.
declare module 'exifr/dist/lite.esm.mjs' {
  import exifr from 'exifr';
  export default exifr;
}
