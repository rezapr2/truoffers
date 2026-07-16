'use client';

import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Business } from '@/lib/types';

// Map view of nearby takeaways (OpenStreetMap tiles — no API key needed).
// Rendered client-side only; import with next/dynamic and ssr: false.
export default function OffersMap({ businesses }: { businesses: Business[] }) {
  const located = businesses.filter((b) => b.location?.coordinates?.length === 2);
  if (located.length === 0) {
    return (
      <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
        No mappable takeaways in this search.
      </div>
    );
  }

  // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]
  const points = located.map(
    (b) => [b.location!.coordinates[1], b.location!.coordinates[0]] as [number, number],
  );
  const bounds: LatLngBoundsExpression = points;

  return (
    <div className="rounded-3xl overflow-hidden border border-line h-[480px]">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [40, 40], maxZoom: 15 }}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map((b, i) => (
          <CircleMarker
            key={b._id}
            center={points[i]}
            radius={b.sponsored ? 12 : 9}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: b.sponsored ? '#e05a33' : '#1a1a1a',
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <div className="font-sans">
                <div className="font-extrabold text-sm">
                  {b.name}
                  {b.sponsored ? ' · Sponsored' : ''}
                </div>
                <div className="text-xs">
                  {b.reviews?.rating ? `${b.reviews.rating}★ (${b.reviews.count}) · ` : ''}
                  {b.activeOfferCount} live offer{b.activeOfferCount === 1 ? '' : 's'}
                  {b.distanceMiles != null ? ` · ${b.distanceMiles} mi` : ''}
                </div>
                <Link href={`/takeaway/${b.slug}`} className="text-xs font-bold underline">
                  View offers
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
