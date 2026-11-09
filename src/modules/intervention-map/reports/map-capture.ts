// The map as it is on screen, drawn onto a canvas for printing: the basemap tiles, the shaded barangays
// and boundary lines, the markers and clusters, and the municipality labels, each where it shows. It
// reads what Leaflet has drawn rather than drawing again, so the print matches the screen.

export interface CapturedMap {
  // A PNG, twice the screen's size, so it prints sharp.
  image: string;
  width: number;
  height: number;
  // Left out if the tile server wouldn't allow it to be copied.
  basemapLeftOut: boolean;
}

const SCALE = 2;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An image on the map could not be read.'));
    image.src = url;
  });

// Leaflet's panes, bottom to top, leaving out popups, which aren't part of the map.
function panesInOrder(container: HTMLElement): HTMLElement[] {
  const panes = [...container.querySelectorAll<HTMLElement>('.leaflet-map-pane > .leaflet-pane')].filter((pane) => !pane.classList.contains('leaflet-popup-pane'));
  return panes
    .map((pane, index) => ({ pane, index, z: Number.parseInt(getComputedStyle(pane).zIndex, 10) || 0 }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((entry) => entry.pane);
}

function isTainted(context: CanvasRenderingContext2D): boolean {
  try {
    context.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

async function drawSvg(context: CanvasRenderingContext2D, svg: SVGSVGElement, at: DOMRect, origin: DOMRect) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute('style');
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(at.width));
  copy.setAttribute('height', String(at.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const image = await loadImage(url);
    context.drawImage(image, at.left - origin.left, at.top - origin.top, at.width, at.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawMarker(context: CanvasRenderingContext2D, marker: HTMLElement, origin: DOMRect) {
  const dot = marker.querySelector<HTMLElement>('span');
  if (!dot) return;
  const box = dot.getBoundingClientRect();
  const x = box.left - origin.left + box.width / 2;
  const y = box.top - origin.top + box.height / 2;
  const radius = box.width / 2;
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = 3;
  context.shadowOffsetY = 1;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = getComputedStyle(dot).backgroundColor;
  context.fill();
  context.restore();
  context.lineWidth = 2;
  context.strokeStyle = '#ffffff';
  context.beginPath();
  context.arc(x, y, radius - 1, 0, Math.PI * 2);
  context.stroke();
  const icon = dot.querySelector('img');
  if (icon?.complete && icon.naturalWidth > 0) {
    const at = icon.getBoundingClientRect();
    context.drawImage(icon, at.left - origin.left, at.top - origin.top, at.width, at.height);
  }
}

function drawCluster(context: CanvasRenderingContext2D, cluster: HTMLElement, origin: DOMRect) {
  const dot = cluster.querySelector<HTMLElement>('span') ?? cluster;
  const box = dot.getBoundingClientRect();
  const style = getComputedStyle(dot);
  const x = box.left - origin.left + box.width / 2;
  const y = box.top - origin.top + box.height / 2;
  context.beginPath();
  context.arc(x, y, box.width / 2, 0, Math.PI * 2);
  context.fillStyle = style.backgroundColor;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#ffffff';
  context.stroke();
  context.fillStyle = style.color;
  context.font = `600 ${style.fontSize} ${style.fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(dot.textContent ?? '', x, y + 0.5);
}

function drawLabel(context: CanvasRenderingContext2D, label: HTMLElement, origin: DOMRect) {
  const box = label.getBoundingClientRect();
  const style = getComputedStyle(label);
  context.fillStyle = style.backgroundColor;
  context.beginPath();
  context.roundRect(box.left - origin.left, box.top - origin.top, box.width, box.height, 3);
  context.fill();
  context.fillStyle = style.color;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label.textContent ?? '', box.left - origin.left + box.width / 2, box.top - origin.top + box.height / 2 + 0.5);
}

async function draw(container: HTMLElement, withTiles: boolean): Promise<{ canvas: HTMLCanvasElement; tainted: boolean }> {
  const origin = container.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(origin.width * SCALE);
  canvas.height = Math.round(origin.height * SCALE);
  const context = canvas.getContext('2d')!;
  context.scale(SCALE, SCALE);
  context.fillStyle = getComputedStyle(container).backgroundColor || '#dddddd';
  context.fillRect(0, 0, origin.width, origin.height);

  for (const pane of panesInOrder(container)) {
    for (const element of pane.querySelectorAll<HTMLElement | SVGSVGElement>('img.leaflet-tile, svg, .intervention-marker, .marker-cluster-count, .leaflet-tooltip')) {
      if (element instanceof HTMLImageElement) {
        if (!withTiles || !element.complete || element.naturalWidth === 0 || getComputedStyle(element).opacity === '0') continue;
        const at = element.getBoundingClientRect();
        context.drawImage(element, at.left - origin.left, at.top - origin.top, at.width, at.height);
      } else if (element instanceof SVGSVGElement) {
        // A renderer's own drawing, not an icon inside a marker.
        if (element.closest('.leaflet-marker-icon')) continue;
        await drawSvg(context, element, element.getBoundingClientRect(), origin);
      } else if (element.classList.contains('intervention-marker')) {
        drawMarker(context, element, origin);
      } else if (element.classList.contains('marker-cluster-count')) {
        drawCluster(context, element, origin);
      } else if (element.classList.contains('leaflet-tooltip')) {
        drawLabel(context, element, origin);
      }
    }
  }
  return { canvas, tainted: isTainted(context) };
}

export async function captureMap(container: HTMLElement): Promise<CapturedMap> {
  let basemapLeftOut = false;
  let { canvas, tainted } = await draw(container, true);
  if (tainted) {
    // A tile server that doesn't allow copying makes the whole picture unreadable, so try without.
    ({ canvas, tainted } = await draw(container, false));
    basemapLeftOut = true;
    if (tainted) throw new Error('The map could not be copied for printing.');
  }
  const box = container.getBoundingClientRect();
  return { image: canvas.toDataURL('image/png'), width: box.width, height: box.height, basemapLeftOut };
}
