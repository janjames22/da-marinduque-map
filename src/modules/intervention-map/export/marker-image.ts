// Draws a record's marker as the map shows it: a white icon on the program's color, with a white
// ring. Google Earth can't read SVG, so KMZ files carry these as PNG.
import { whiteIconSvg } from '../lib/display';

export const MARKER_SIZE = 64;

// A record with no icon gets a plain dot. Both forms render the same way in a browser and in Node.
export const iconDataUrl = (svg: string) =>
  `data:image/svg+xml,${encodeURIComponent(whiteIconSvg(svg).replace('<svg ', `<svg width="${MARKER_SIZE}" height="${MARKER_SIZE}" `))}`;

interface MarkerCanvas {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  beginPath(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
}

// The map's marker is 26 across with a 2 ring and a 15 icon, so these keep its proportions.
export function drawMarker<Image>(
  context: MarkerCanvas & { drawImage(image: Image, x: number, y: number, width: number, height: number): void },
  color: string,
  image: Image | null,
) {
  const middle = MARKER_SIZE / 2;
  const ring = MARKER_SIZE * (2 / 26);
  context.beginPath();
  context.arc(middle, middle, middle - ring / 2 - 1, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = ring;
  context.strokeStyle = '#ffffff';
  context.stroke();
  if (image) {
    const size = MARKER_SIZE * (15 / 26);
    context.drawImage(image, middle - size / 2, middle - size / 2, size, size);
  }
}

export type RenderMarker = (svg: string | null, color: string) => Promise<Uint8Array>;

export const renderMarkerInBrowser: RenderMarker = async (svg, color) => {
  const canvas = document.createElement('canvas');
  canvas.width = MARKER_SIZE;
  canvas.height = MARKER_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser can\'t draw the map icons.');

  let image: HTMLImageElement | null = null;
  if (svg) {
    const loading = new Image();
    await new Promise<void>((resolve, reject) => {
      loading.onload = () => resolve();
      loading.onerror = () => reject(new Error('A map icon could not be drawn.'));
      loading.src = iconDataUrl(svg);
    });
    image = loading;
  }
  drawMarker(context, color, image);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('A map icon could not be drawn.');
  return new Uint8Array(await blob.arrayBuffer());
};
