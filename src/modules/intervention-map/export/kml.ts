// KML for Google Earth and QGIS. Folders run Municipality, Barangay, Type. Coordinates are written
// longitude first, and colors as aabbggrr, as KML requires.
import JSZip from 'jszip';
import type { Barangay, Intervention, MapData, Municipality } from '../data/types';
import { binFor, COUNT_BINS, countByBarangay, GAP_NONE_COLOR } from '../lib/choropleth';
import { escapeHtml, recordColor, recordIcon } from '../lib/display';
import { buildFields, placemarkName, unlocatedLine, type ExportField, type FieldValue } from './fields';
import type { RenderMarker } from './marker-image';
import { isLocated, NEEDS_LOCATION_CHECK, needsLocationCheck } from './records';

export interface KmlLayers {
  municipalBoundaries: boolean;
  barangayBoundaries: boolean;
  gapMap: boolean;
}

export interface KmlBoundaries {
  barangays: GeoJSON.FeatureCollection;
  municipalities: GeoJSON.FeatureCollection;
}

export interface KmlInput {
  records: Intervention[];
  data: MapData;
  boundaries: KmlBoundaries;
  layers: KmlLayers;
  title: string;
  filterLines: string[];
  exportedOn: string;
  exportedBy: string | null;
  // The places the export covers, so optional layers don't draw the rest of the province.
  barangays: Barangay[];
  municipalities: Municipality[];
}

// Plain KML can't carry its own icons, so it colors Google's standard dot. KMZ brings the real ones.
const STANDARD_DOT = 'https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';
const GAP_NOTE = 'Shows what has been encoded, not what exists on the ground.';
const NO_BARANGAY = 'No barangay';
const collator = new Intl.Collator('en');

// Characters XML can't hold at all would make the whole file unreadable.
// eslint-disable-next-line no-control-regex
const xmlSafe = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const xml = (text: string) => escapeHtml(xmlSafe(text));
// Every value in here went through escapeHtml, so no value can end the CDATA section early.
const cdata = (html: string) => `<![CDATA[${xmlSafe(html)}]]>`;

export function kmlColor(hex: string, alpha = 0xff): string {
  const [red, green, blue] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return `${alpha.toString(16).padStart(2, '0')}${blue}${green}${red}`.toLowerCase();
}

const positionText = ([longitude, latitude]: number[]) => `${longitude},${latitude},0`;
const lineText = (positions: number[][]) => positions.map(positionText).join(' ');

function polygonXml(rings: number[][][]): string {
  const [outer, ...holes] = rings;
  const inner = holes.map((ring) => `<innerBoundaryIs><LinearRing><coordinates>${lineText(ring)}</coordinates></LinearRing></innerBoundaryIs>`).join('');
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${lineText(outer)}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
}

export function geometryXml(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `<Point><coordinates>${positionText(geometry.coordinates)}</coordinates></Point>`;
    case 'LineString':
      return `<LineString><tessellate>1</tessellate><coordinates>${lineText(geometry.coordinates)}</coordinates></LineString>`;
    case 'Polygon':
      return polygonXml(geometry.coordinates);
    case 'MultiPoint':
      return `<MultiGeometry>${geometry.coordinates.map((position) => `<Point><coordinates>${positionText(position)}</coordinates></Point>`).join('')}</MultiGeometry>`;
    case 'MultiLineString':
      return `<MultiGeometry>${geometry.coordinates.map((line) => geometryXml({ type: 'LineString', coordinates: line })).join('')}</MultiGeometry>`;
    case 'MultiPolygon':
      return `<MultiGeometry>${geometry.coordinates.map(polygonXml).join('')}</MultiGeometry>`;
    case 'GeometryCollection':
      return `<MultiGeometry>${geometry.geometries.map(geometryXml).join('')}</MultiGeometry>`;
  }
}

const valueText = (value: FieldValue) => (value === null ? '' : String(value));

function balloon(record: Intervention, fields: ExportField[]): string {
  const rows = fields
    .filter((field) => !field.typeIds || field.typeIds.has(record.intervention_type_id))
    .map((field) => `<tr><th align="left" valign="top">${escapeHtml(field.label)}</th><td>${escapeHtml(valueText(field.read(record))) || '—'}</td></tr>`);
  return `<table border="1" cellpadding="3" cellspacing="0">${rows.join('')}</table>`;
}

function extendedData(rows: [string, string][]): string {
  return `<ExtendedData>${rows.map(([name, value]) => `<Data name="${xml(name)}"><value>${xml(value)}</value></Data>`).join('')}</ExtendedData>`;
}

interface MarkerStyle {
  id: string;
  color: string;
  svg: string | null;
  iconPath: string;
}

function markerStyleFor(record: Intervention, data: MapData, styles: Map<string, MarkerStyle>): MarkerStyle {
  const color = recordColor(record, data);
  const icon = recordIcon(record, data);
  const name = `${(icon?.name ?? 'dot').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${color.slice(1).toLowerCase()}`;
  const existing = styles.get(name);
  if (existing) return existing;
  const style = { id: `marker-${name}`, color, svg: icon?.image ?? null, iconPath: `icons/${name}.png` };
  styles.set(name, style);
  return style;
}

// Labels stay hidden until a marker is pointed at, or hundreds of them would cover the map.
function markerStyleXml(style: MarkerStyle, packaged: boolean): string {
  // KML fixes the order of these elements: color, then scale, then the icon.
  const color = packaged ? '' : `<color>${kmlColor(style.color)}</color>`;
  const href = packaged ? style.iconPath : STANDARD_DOT;
  const iconStyle = (scale: number) =>
    `<IconStyle>${color}<scale>${scale}</scale><Icon><href>${href}</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>`;
  const shapes = `<LineStyle><color>${kmlColor(style.color)}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(style.color, 0x66)}</color></PolyStyle>`;
  return (
    `<Style id="${style.id}-normal">${iconStyle(0.8)}<LabelStyle><scale>0</scale></LabelStyle>${shapes}</Style>` +
    `<Style id="${style.id}-highlight">${iconStyle(1)}<LabelStyle><scale>1</scale></LabelStyle>${shapes}</Style>` +
    `<StyleMap id="${style.id}"><Pair><key>normal</key><styleUrl>#${style.id}-normal</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#${style.id}-highlight</styleUrl></Pair></StyleMap>`
  );
}

function folder(name: string, content: string, description?: string): string {
  const note = description ? `<description>${cdata(description)}</description>` : '';
  return `<Folder><name>${xml(name)}</name>${note}${content}</Folder>`;
}

function recordPlacemark(record: Intervention, data: MapData, fields: ExportField[], styles: Map<string, MarkerStyle>): string {
  const style = markerStyleFor(record, data, styles);
  const rows = fields.map((field): [string, string] => [field.key, valueText(field.read(record))]);
  return (
    `<Placemark><name>${xml(placemarkName(record, data))}</name>` +
    `<description>${cdata(balloon(record, fields))}</description>` +
    `<styleUrl>#${style.id}</styleUrl>${extendedData(rows)}${geometryXml(record.geojson!)}</Placemark>`
  );
}

// Kept out of the municipality folders, so a point in the wrong place can't pass for a real one there.
function locationCheckFolder(records: Intervention[], data: MapData, fields: ExportField[], styles: Map<string, MarkerStyle>): string {
  if (records.length === 0) return '';
  const placemarks = [...records].sort((a, b) => collator.compare(placemarkName(a, data), placemarkName(b, data))).map((record) => recordPlacemark(record, data, fields, styles));
  return folder(NEEDS_LOCATION_CHECK, placemarks.join(''), '<p>The coordinates of these records are outside Marinduque, so they may not show where the intervention really is. Check each location.</p>');
}

function recordFolders(records: Intervention[], data: MapData, fields: ExportField[], styles: Map<string, MarkerStyle>): string {
  const municipalityOf = (record: Intervention) => data.municipalities.find((m) => m.id === record.municipality_id)?.name ?? 'No municipality';
  const barangayOf = (record: Intervention) => data.barangays.find((b) => b.id === record.barangay_id)?.name ?? NO_BARANGAY;
  const typeOf = (record: Intervention) => data.types.find((t) => t.id === record.intervention_type_id);

  const groupBy = <K>(items: Intervention[], key: (item: Intervention) => K) => {
    const groups = new Map<K, Intervention[]>();
    for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
    return [...groups];
  };

  return groupBy(records, municipalityOf)
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([municipality, inMunicipality]) => {
      const barangays = groupBy(inMunicipality, barangayOf)
        // Records with no barangay go last, so they aren't mistaken for a place called that.
        .sort(([a], [b]) => Number(a === NO_BARANGAY) - Number(b === NO_BARANGAY) || collator.compare(a, b))
        .map(([barangay, inBarangay]) => {
          const types = groupBy(inBarangay, (record) => record.intervention_type_id)
            .sort(([a], [b]) => (data.types.find((t) => t.id === a)?.sort_order ?? 0) - (data.types.find((t) => t.id === b)?.sort_order ?? 0))
            .map(([, ofType]) => {
              const placemarks = [...ofType]
                .sort((a, b) => collator.compare(placemarkName(a, data), placemarkName(b, data)))
                .map((record) => recordPlacemark(record, data, fields, styles));
              return folder(typeOf(ofType[0])?.name ?? 'Other', placemarks.join(''));
            });
          return folder(barangay, types.join(''));
        });
      return folder(municipality, barangays.join(''));
    })
    .join('');
}

function boundaryPlacemark(name: string, geometry: GeoJSON.Geometry, style: string, description = '', data = ''): string {
  const note = description ? `<description>${cdata(description)}</description>` : '';
  return `<Placemark><name>${xml(name)}</name>${note}<styleUrl>#${style}</styleUrl>${data}${geometryXml(geometry)}</Placemark>`;
}

function outlineStyle(id: string, color: string, width: number): string {
  return `<Style id="${id}"><LineStyle><color>${kmlColor(color)}</color><width>${width}</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`;
}

function boundaryFolder(input: KmlInput): { styles: string; content: string } {
  const { layers, boundaries, barangays, municipalities } = input;
  const items: string[] = [];
  const styles: string[] = [];

  if (layers.municipalBoundaries) {
    styles.push(outlineStyle('outline-municipal', '#14532d', 3));
    const placemarks = [...municipalities]
      .sort((a, b) => collator.compare(a.name, b.name))
      .flatMap((municipality) => {
        const feature = boundaries.municipalities.features.find((f) => f.properties?.adm3_pcode === municipality.psgc_code);
        return feature ? [boundaryPlacemark(municipality.name, feature.geometry, 'outline-municipal')] : [];
      });
    items.push(folder('Municipal boundaries', placemarks.join('')));
  }

  if (layers.barangayBoundaries) {
    styles.push(outlineStyle('outline-barangay', '#6b6a66', 1));
    const placemarks = [...barangays]
      .sort((a, b) => collator.compare(a.name, b.name))
      .flatMap((barangay) => {
        const feature = boundaries.barangays.features.find((f) => f.properties?.adm4_pcode === barangay.psgc_code);
        return feature ? [boundaryPlacemark(barangay.name, feature.geometry, 'outline-barangay')] : [];
      });
    items.push(folder('Barangay boundaries', placemarks.join('')));
  }

  return { styles: styles.join(''), content: items.length > 0 ? folder('Boundaries', items.join('')) : '' };
}

function gapStyle(id: string, color: string): string {
  return `<Style id="${id}"><LineStyle><color>${kmlColor('#6b6a66')}</color><width>1</width></LineStyle><PolyStyle><color>${kmlColor(color, 0xb3)}</color></PolyStyle></Style>`;
}

function gapLayer(input: KmlInput): { styles: string; content: string } {
  const { records, data, boundaries, barangays, municipalities } = input;
  const counts = countByBarangay(records, data.links);
  const styles = gapStyle('gap-none', GAP_NONE_COLOR) + COUNT_BINS.map((bin, index) => gapStyle(`gap-${index + 1}`, bin.color)).join('');

  const linksOf = (barangayId: number) => {
    const ids = new Set(data.links.filter((link) => link.barangay_id === barangayId).map((link) => link.intervention_id));
    return records.filter((record) => ids.has(record.id));
  };
  const breakdown = (rows: Intervention[], nameOf: (record: Intervention) => string) => {
    const tally = new Map<string, number>();
    for (const row of rows) tally.set(nameOf(row), (tally.get(nameOf(row)) ?? 0) + 1);
    return [...tally]
      .sort(([a], [b]) => collator.compare(a, b))
      .map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td align="right">${count}</td></tr>`)
      .join('');
  };

  const folders = [...municipalities].sort((a, b) => collator.compare(a.name, b.name)).map((municipality) => {
    const placemarks = barangays
      .filter((barangay) => barangay.municipality_id === municipality.id)
      .sort((a, b) => collator.compare(a.name, b.name))
      .flatMap((barangay) => {
        const feature = boundaries.barangays.features.find((f) => f.properties?.adm4_pcode === barangay.psgc_code);
        if (!feature) return [];
        const count = counts.get(barangay.id) ?? 0;
        const bin = binFor(count);
        const style = bin ? `gap-${COUNT_BINS.indexOf(bin) + 1}` : 'gap-none';
        const linked = linksOf(barangay.id);
        const description =
          `<table border="1" cellpadding="3" cellspacing="0">` +
          `<tr><th align="left">Barangay</th><td>${escapeHtml(barangay.name)}</td></tr>` +
          `<tr><th align="left">Municipality</th><td>${escapeHtml(municipality.name)}</td></tr>` +
          `<tr><th align="left">PSGC</th><td>${escapeHtml(barangay.psgc_code)}</td></tr>` +
          `<tr><th align="left">Interventions</th><td>${count}</td></tr>` +
          breakdown(linked, (record) => data.types.find((t) => t.id === record.intervention_type_id)?.name ?? 'Unknown type') +
          breakdown(linked, (record) => data.programs.find((p) => p.id === record.banner_program_id)?.name ?? 'No program') +
          `</table><p>${escapeHtml(GAP_NOTE)}</p>`;
        const fields = extendedData([
          ['Barangay', barangay.name],
          ['Municipality', municipality.name],
          ['Psgc', barangay.psgc_code],
          ['Interventions', String(count)],
        ]);
        return [boundaryPlacemark(`${barangay.name}: ${count === 0 ? 'none encoded yet' : count}`, feature.geometry, style, description, fields)];
      });
    return folder(municipality.name, placemarks.join(''));
  });

  const key = [`<li style="color:${GAP_NONE_COLOR}">None encoded yet</li>`, ...COUNT_BINS.map((bin) => `<li style="color:${bin.color}">${escapeHtml(bin.label)}</li>`)].join('');
  return { styles, content: folder('Barangay gap map', folders.join(''), `<p>Number of interventions in each barangay. ${escapeHtml(GAP_NOTE)}</p><ul>${key}</ul>`) };
}

function documentDescription(input: KmlInput, located: Intervention[], unlocated: Intervention[]): string {
  const { data, filterLines, exportedOn, exportedBy, layers } = input;
  const toCheck = located.filter(needsLocationCheck).length;
  const programs = data.programs
    .filter((program) => located.some((record) => record.banner_program_id === program.id))
    .map((program) => `<tr><td bgcolor="${program.color}">&nbsp;&nbsp;&nbsp;</td><td>${escapeHtml(program.name)}</td></tr>`)
    .join('');
  const parts = [
    `<p><b>${input.records.length}</b> records: ${located.length} on the map, ${unlocated.length} without coordinates.</p>`,
    `<p>Exported ${escapeHtml(exportedOn)}${exportedBy ? ` by ${escapeHtml(exportedBy)}` : ''}.</p>`,
    toCheck > 0 ? `<p><b>${toCheck} ${toCheck === 1 ? 'record has' : 'records have'} coordinates outside Marinduque.</b> See the folder "${escapeHtml(NEEDS_LOCATION_CHECK)}".</p>` : '',
    filterLines.length > 0 ? `<p>Filters:</p><ul>${filterLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '',
    programs ? `<p>Marker color is the program:</p><table cellpadding="2">${programs}</table>` : '',
    unlocated.length > 0
      ? `<p><b>Left out, as they have no coordinates (${unlocated.length}):</b></p><ol>${unlocated.map((record) => `<li>${escapeHtml(unlocatedLine(record, data))}</li>`).join('')}</ol>`
      : '',
    layers.municipalBoundaries || layers.barangayBoundaries || layers.gapMap ? '<p>Boundaries: NAMRIA, PSA via HDX (CC BY-IGO).</p>' : '',
  ];
  return parts.join('');
}

export interface BuiltKml {
  kml: string;
  markers: MarkerStyle[];
  placemarks: number;
}

export function buildKml(input: KmlInput, packaged: boolean): BuiltKml {
  const { records, data, layers, title } = input;
  const located = records.filter(isLocated);
  const unlocated = records.filter((record) => !isLocated(record)).sort((a, b) => collator.compare(placemarkName(a, data), placemarkName(b, data)));
  const fields = buildFields(records, data);
  const styles = new Map<string, MarkerStyle>();

  // Built first, as this is what finds out which marker styles are needed.
  const checkXml = locationCheckFolder(located.filter(needsLocationCheck), data, fields, styles);
  const recordsXml = recordFolders(located.filter((record) => !needsLocationCheck(record)), data, fields, styles);
  const boundaries = boundaryFolder(input);
  const gap = layers.gapMap ? gapLayer(input) : { styles: '', content: '' };
  const markerStyles = [...styles.values()];

  const kml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name><open>1</open>` +
    `<Snippet maxLines="1">${xml(`${located.length} on the map, ${unlocated.length} without coordinates`)}</Snippet>` +
    `<description>${cdata(documentDescription(input, located, unlocated))}</description>` +
    markerStyles.map((style) => markerStyleXml(style, packaged)).join('') +
    boundaries.styles +
    gap.styles +
    boundaries.content +
    gap.content +
    checkXml +
    recordsXml +
    `</Document></kml>`;

  return { kml, markers: markerStyles, placemarks: located.length };
}

export async function buildKmz(input: KmlInput, renderMarker: RenderMarker): Promise<Uint8Array> {
  const { kml, markers } = buildKml(input, true);
  const zip = new JSZip();
  // Readers look for the first .kml file, so doc.kml goes in first, at the top level.
  zip.file('doc.kml', kml);
  const images = await Promise.all(markers.map(async (marker) => [marker.iconPath, await renderMarker(marker.svg, marker.color)] as const));
  for (const [path, image] of images) zip.file(path, image);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
