// Matching place names from a file to the barangay list. Used by the import wizard and by the RAED
// seed, so every dataset is matched the same way. It never guesses at spelling: a name that still
// differs is kept as written, flagged, and shown with its closest candidates.

// Handles case, spacing, hyphens and Pob./Poblacion, and reads n-tilde as n.
export function normalizeBarangayName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bpoblacion\b/g, 'pob')
    .replace(/\bpob\./g, 'pob')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every form a name can match under. n-tilde is written as both n and ny (Kinaman, Kinyaman).
export function barangayNameKeys(name: string): string[] {
  const composed = name.normalize('NFC');
  const keys = [normalizeBarangayName(composed)];
  if (/ñ/i.test(composed)) keys.push(normalizeBarangayName(composed.replace(/ñ/gi, 'ny')));
  return keys;
}

export function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

export interface PlaceName {
  id: number;
  name: string;
  // The municipality's name. A barangay is only ever matched within its own municipality.
  municipality: string;
}

export class BarangayIndex<T extends PlaceName = PlaceName> {
  private keys = new Map<string, T>();

  constructor(barangays: T[]) {
    for (const barangay of barangays) {
      for (const key of barangayNameKeys(barangay.name)) {
        const fullKey = `${barangay.municipality}|${key}`;
        const clash = this.keys.get(fullKey);
        if (clash && clash.id !== barangay.id) {
          throw new Error(`"${clash.name}" and "${barangay.name}" normalize to the same name`);
        }
        this.keys.set(fullKey, barangay);
      }
    }
  }

  find(municipality: string, name: string): T | undefined {
    for (const key of barangayNameKeys(name)) {
      const match = this.keys.get(`${municipality}|${key}`);
      if (match) return match;
    }
    return undefined;
  }
}

export interface BarangayCandidate {
  name: string;
  municipality: string;
  distance: number;
}

// The nearest spellings, in the same municipality first, for a person to choose from.
export function closestBarangays(name: string, municipality: string, barangays: PlaceName[], shown = 3) {
  const target = normalizeBarangayName(name);
  const ranked: BarangayCandidate[] = barangays
    .map((b) => ({ name: b.name, municipality: b.municipality, distance: levenshtein(target, normalizeBarangayName(b.name)) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return {
    sameMunicipality: ranked.filter((c) => c.municipality === municipality).slice(0, shown),
    otherMunicipalities: ranked.filter((c) => c.municipality !== municipality).slice(0, shown),
  };
}

// A list item from what a file calls it: case, spacing and punctuation don't matter. "Rice Program",
// "RICE PROGRAM" and "Rice-Program" are one.
export const looseKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
