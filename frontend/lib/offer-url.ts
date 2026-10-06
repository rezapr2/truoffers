/** The shareable offer address, /offer/{id}-{slug} (spec T5.6). */
export function offerHref(offer: { _id: string; slug?: string }): string {
  return offer.slug ? `/offer/${offer._id}-${offer.slug}` : `/offer/${offer._id}`;
}
