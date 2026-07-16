// Postcode helpers. Geocoding tries postcodes.io (free, no key) and falls
// back to a static outward-code table so dev/seed works offline.

const OUTWARD_COORDS: Record<string, [number, number]> = {
  // [lng, lat]
  M1: [-2.2426, 53.4794], M14: [-2.2338, 53.4451], M13: [-2.2202, 53.4569],
  M20: [-2.2312, 53.4172], M4: [-2.2266, 53.4841], M8: [-2.2394, 53.5183],
  B1: [-1.909, 52.4796], B5: [-1.8944, 52.4692], B12: [-1.8817, 52.4632],
  B19: [-1.9095, 52.5009], LS1: [-1.5486, 53.7997], LS6: [-1.5734, 53.8188],
  LS8: [-1.5108, 53.8331], S1: [-1.4701, 53.3792], S7: [-1.4877, 53.3499],
  L1: [-2.9834, 53.4048], NG1: [-1.1465, 52.9536], YO21: [-0.6431, 54.4837],
  M44: [-2.4225, 53.445], OL1: [-2.1092, 53.5444], SK4: [-2.1729, 53.4213],
  E1: [-0.0662, 51.5152], N1: [-0.1032, 51.5362], SW9: [-0.1146, 51.4622],
  G1: [-4.2481, 55.8587],
};

export function outwardCode(postcode: string): string {
  const clean = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  return clean.split(' ')[0];
}

export function normalisePostcode(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s+/g, ' ');
}

export async function geocodePostcode(
  postcode: string,
): Promise<{ lng: number; lat: number; area: string } | null> {
  const area = outwardCode(postcode);
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data: any = await res.json();
      if (data?.result?.longitude != null) {
        return { lng: data.result.longitude, lat: data.result.latitude, area };
      }
    }
    // Outward-code-only searches (e.g. "M14") resolve via the outcode endpoint
    const res2 = await fetch(
      `https://api.postcodes.io/outcodes/${encodeURIComponent(area)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res2.ok) {
      const data: any = await res2.json();
      if (data?.result?.longitude != null) {
        return { lng: data.result.longitude, lat: data.result.latitude, area };
      }
    }
  } catch {
    // fall through to static table
  }
  const coords = OUTWARD_COORDS[area];
  if (coords) return { lng: coords[0], lat: coords[1], area };
  return null;
}
