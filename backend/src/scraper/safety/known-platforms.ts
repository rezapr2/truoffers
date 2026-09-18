/**
 * White-label ordering platforms the robot recognises even before an admin has recorded a policy for them
 * (spec §2.3). A website on one of these is held for provider review, and an "unknown" policy is created for
 * the admin to decide, instead of the site being crawled as an independent takeaway.
 *
 * Signatures are hosts the platform serves its clients' assets from; they appear in the page's asset tags,
 * structured data or embedded page data.
 */
export interface KnownPlatform {
  name: string;
  assetHosts: string[];
}

export const KNOWN_ORDERING_PLATFORMS: KnownPlatform[] = [
  { name: 'Foodhub', assetHosts: ['foodhub.com', 'foodhub.co.uk'] },
  { name: 'Grub24', assetHosts: ['grub24.co.uk'] },
];
