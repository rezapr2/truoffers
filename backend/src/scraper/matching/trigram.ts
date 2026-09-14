// Same definition as PostgreSQL pg_trgm, so the spec's 0.8 threshold means what it means there:
// each alphanumeric word is padded with two leading spaces and one trailing space, and
// similarity is shared trigrams divided by all distinct trigrams.

export function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  const words = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) result.add(padded.slice(i, i + 3));
  }
  return result;
}

export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared++;
  return shared / (left.size + right.size - shared);
}
