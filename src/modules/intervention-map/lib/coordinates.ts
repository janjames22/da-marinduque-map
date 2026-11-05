export interface LatLng {
  lat: number;
  lng: number;
}

export type ParseResult = { ok: true; point: LatLng; note?: string } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

// Seven decimals is about 1 cm, finer than any phone or map click can place a point.
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

export function roundPoint(point: LatLng): LatLng {
  return { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) };
}

export function formatPoint(point: LatLng): string {
  return `${point.lat}, ${point.lng}`;
}

export function googleMapsUrl(point: LatLng): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${point.lat},${point.lng}`)}`;
}

function checkRange(lat: number, lng: number, note?: string): ParseResult {
  if (Math.abs(lat) > 90) return fail('Latitude must be between -90 and 90.');
  if (Math.abs(lng) > 180) return fail('Longitude must be between -180 and 180.');
  return { ok: true, point: { lat: roundCoordinate(lat), lng: roundCoordinate(lng) }, ...(note ? { note } : {}) };
}

// The three ways a Google Maps link carries coordinates, most exact first: the place's own pin,
// a search query, then the centre of the view.
function parseMapsUrl(text: string): ParseResult {
  if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(text)) {
    return fail('Short links can\'t be read here. Open the link, then copy the coordinates from Google Maps.');
  }
  const decoded = decodeURIComponent(text);
  const number = '(-?\\d+(?:\\.\\d+)?)';
  const pin = decoded.match(new RegExp(`!3d${number}!4d${number}`));
  const query = decoded.match(new RegExp(`[?&](?:q|query|ll|destination|daddr|center)=(?:loc:)?${number},\\s*\\+?${number}`));
  const view = decoded.match(new RegExp(`/@${number},${number}`));
  const match = pin ?? query ?? view;
  if (!match) return fail('This link has no coordinates in it.');
  return checkRange(Number(match[1]), Number(match[2]));
}

type Token =
  | { kind: 'number'; value: number; text: string }
  | { kind: 'unit'; unit: '°' | "'" | '"' }
  | { kind: 'hemisphere'; letter: 'N' | 'S' | 'E' | 'W' }
  | { kind: 'separator' };

function tokenize(text: string): Token[] | null {
  const normalized = text
    .toUpperCase()
    .replace(/\b(?:LATITUDE|LONGITUDE|LAT|LONG|LNG|LON)\b\s*[:=]?/g, ' ')
    .replace(/DEG(?:REES?)?\b/g, '°')
    .replace(/º/g, '°')
    .replace(/[’′]/g, "'")
    .replace(/[″”“]|''/g, '"');

  const tokens: Token[] = [];
  for (const [piece] of normalized.matchAll(/[+-]?\d+(?:\.\d+)?|[NSEW°'",;]|\S/g)) {
    if (/\d/.test(piece)) tokens.push({ kind: 'number', value: Number(piece), text: piece });
    else if (piece === '°' || piece === "'" || piece === '"') tokens.push({ kind: 'unit', unit: piece });
    else if (piece === 'N' || piece === 'S' || piece === 'E' || piece === 'W') tokens.push({ kind: 'hemisphere', letter: piece });
    else if (piece === ',' || piece === ';') tokens.push({ kind: 'separator' });
    else return null;
  }
  return tokens;
}

interface Group {
  numbers: { value: number; text: string }[];
  hemisphere: 'N' | 'S' | 'E' | 'W' | null;
  lastUnit: string | null;
}

const emptyGroup = (): Group => ({ numbers: [], hemisphere: null, lastUnit: null });

// Splits the tokens into one group per coordinate. Written forms mark the split with a comma, a
// hemisphere letter, a seconds mark or a second degree mark.
function groupTokens(tokens: Token[]): Group[] {
  const prefixHemisphere = tokens[0]?.kind === 'hemisphere';
  const groups: Group[] = [];
  let current = emptyGroup();
  const flush = () => {
    if (current.numbers.length > 0) groups.push(current);
    current = emptyGroup();
  };

  tokens.forEach((token, index) => {
    if (token.kind === 'separator') {
      flush();
    } else if (token.kind === 'hemisphere') {
      if (prefixHemisphere) {
        flush();
        current.hemisphere = token.letter;
      } else {
        current.hemisphere = token.letter;
        flush();
      }
    } else if (token.kind === 'number') {
      const next = tokens[index + 1];
      const startsNew =
        current.numbers.length > 0 &&
        ((next?.kind === 'unit' && next.unit === '°') || current.lastUnit === '"' || current.numbers.length === 3);
      if (startsNew) flush();
      current.numbers.push({ value: token.value, text: token.text });
    } else {
      current.lastUnit = token.unit;
    }
  });
  flush();

  // Plain spaced numbers ("13 28 1.6 122 4 7.0") have no marks to split on, so they split in half.
  if (groups.length === 1 && [2, 4, 6].includes(groups[0].numbers.length)) {
    const half = groups[0].numbers.length / 2;
    return [
      { ...emptyGroup(), numbers: groups[0].numbers.slice(0, half), hemisphere: groups[0].hemisphere },
      { ...emptyGroup(), numbers: groups[0].numbers.slice(half) },
    ];
  }
  return groups;
}

function toDecimal(group: Group): number | null {
  const [degrees, minutes, seconds] = group.numbers;
  if (group.numbers.length > 1 && degrees.text.includes('.')) return null;
  if (minutes && (minutes.value < 0 || minutes.value >= 60)) return null;
  if (seconds && (seconds.value < 0 || seconds.value >= 60)) return null;
  if (seconds && minutes.text.includes('.')) return null;

  const negative = degrees.text.startsWith('-');
  if (negative && group.hemisphere) return null;
  const size = Math.abs(degrees.value) + (minutes?.value ?? 0) / 60 + (seconds?.value ?? 0) / 3600;
  const opposite = group.hemisphere === 'S' || group.hemisphere === 'W';
  return negative || opposite ? -size : size;
}

const UNREADABLE = 'Couldn\'t read that. Try 13.4671, 122.0686 or 13°28\'01.6"N 122°04\'07.0"E.';

// Reads decimal degrees, degrees-minutes-seconds and Google Maps text or links.
export function parseCoordinates(input: string): ParseResult {
  const text = input.trim();
  if (text === '') return fail('Enter coordinates.');
  if (/https?:\/\/|maps\.google|google\.[a-z.]+\/maps|goo\.gl/i.test(text)) return parseMapsUrl(text);

  const tokens = tokenize(text);
  if (!tokens) return fail(UNREADABLE);
  const groups = groupTokens(tokens);
  if (groups.length !== 2) return fail(UNREADABLE);

  const first = toDecimal(groups[0]);
  const second = toDecimal(groups[1]);
  if (first === null || second === null) return fail(UNREADABLE);

  const axis = (group: Group) =>
    group.hemisphere === 'N' || group.hemisphere === 'S' ? 'lat' : group.hemisphere ? 'lng' : null;
  const [firstAxis, secondAxis] = [axis(groups[0]), axis(groups[1])];
  if (firstAxis && firstAxis === secondAxis) return fail('Both values are the same direction. Use one N/S and one E/W.');
  if (firstAxis === 'lng' || secondAxis === 'lat') return checkRange(second, first);
  if (!firstAxis && !secondAxis && Math.abs(first) > 90 && Math.abs(second) <= 90) {
    return checkRange(second, first, 'Read as longitude first, then latitude.');
  }
  return checkRange(first, second);
}
