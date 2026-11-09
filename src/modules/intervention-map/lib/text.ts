// Comparing names as a person means them. Nothing here imports anything, so any module can use it.

// Ignores case, spacing and marks such as the tilde in Kiñaman, so a search finds what a person means.
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// One beneficiary however it's written, until there's a proper list of beneficiaries: "Bantad F.C.A."
// and "bantad fca" are one, as case, marks, spaces and punctuation are left out.
export const beneficiaryKey = (name: string | null) => foldText(name ?? '').replace(/[^\p{L}\p{N}]/gu, '');
