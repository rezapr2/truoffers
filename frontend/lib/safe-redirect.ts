/**
 * The `?next=` page to return to after signing in, or null when it isn't a path on this site. Anything else
 * (`https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:…`) would make the login page an
 * open redirect.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  // Browsers treat tabs and newlines inside a URL as if they weren't there, so `/\t/evil.example` is `//evil.example`.
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const url = new URL(next, 'https://truoffers.invalid');
    // Resolving dot segments can itself produce `//host` (from `/../..//evil.example`), so check the result too.
    if (url.origin !== 'https://truoffers.invalid' || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
