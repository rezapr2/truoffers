import { SetMetadata } from '@nestjs/common';
import { Role, STAFF_ROLES } from './enums';

/**
 * What staff can do in the admin panel, from the spec's "User roles and permissions" table. Business owners
 * and staff are not in here: their rights are per business (see business-access.ts).
 */
export enum Capability {
  ADMIN_PANEL = 'admin.panel',
  CLAIMS_REVIEW = 'claims.review',
  OFFERS_MODERATE = 'offers.moderate',
  // Edit any business's profile, hours, photos and offers
  BUSINESS_EDIT = 'business.edit',
  // Create, merge, change owner, set verification level
  BUSINESS_MANAGE = 'business.manage',
  BUSINESS_SUSPEND = 'business.suspend',
  // Moderators may only flag a business for suspension
  SUSPENSION_SUGGEST = 'business.suspension_suggest',
  BUSINESS_IMPERSONATE = 'business.impersonate',
  USERS_VIEW = 'users.view',
  USERS_MANAGE = 'users.manage',
  REPORTS_REVIEW = 'reports.review',
  AUDIT_VIEW = 'audit.view',
  BILLING_VIEW = 'billing.view',
  // Refunds, manual plan changes, comp plans
  BILLING_MANAGE = 'billing.manage',
  PLANS_MANAGE = 'plans.manage',
  PROMOTIONS_MANAGE = 'promotions.manage',
  COUPONS_MANAGE = 'coupons.manage',
  TAXONOMY_MANAGE = 'taxonomy.manage',
  CONTENT_MANAGE = 'content.manage',
  TEMPLATES_MANAGE = 'templates.manage',
  TEAM_MANAGE = 'team.manage',
  // The support inbox (contact form and dashboard tickets)
  SUPPORT_MANAGE = 'support.manage',
  // Email, SMS and in-app campaigns
  CAMPAIGNS_MANAGE = 'campaigns.manage',
  SETTINGS_MANAGE = 'settings.manage',
  SCRAPER = 'scraper',
}

const MODERATOR: Capability[] = [
  Capability.ADMIN_PANEL,
  Capability.CLAIMS_REVIEW,
  Capability.OFFERS_MODERATE,
  Capability.BUSINESS_EDIT,
  Capability.SUSPENSION_SUGGEST,
  Capability.USERS_VIEW,
  Capability.REPORTS_REVIEW,
  Capability.AUDIT_VIEW,
  Capability.SCRAPER,
  Capability.SUPPORT_MANAGE,
];

// "admin" sits between moderator and super admin: it can act on businesses and users, but prices, money,
// the admin team and site settings stay with super admins.
const ADMIN: Capability[] = [
  ...MODERATOR,
  Capability.BUSINESS_MANAGE,
  Capability.BUSINESS_SUSPEND,
  Capability.BUSINESS_IMPERSONATE,
  Capability.USERS_MANAGE,
  Capability.BILLING_VIEW,
];

const ALL = Object.values(Capability);

export const ROLE_CAPABILITIES: Partial<Record<Role, readonly Capability[]>> = {
  [Role.MODERATOR]: MODERATOR,
  [Role.SUPPORT_ADMIN]: MODERATOR,
  [Role.ADMIN]: ADMIN,
  [Role.SALES_ADMIN]: ADMIN,
  [Role.SUPER_ADMIN]: ALL,
};

export function capabilitiesOf(role: Role | string | undefined): Capability[] {
  return [...(ROLE_CAPABILITIES[role as Role] ?? [])];
}

export function can(user: { role?: Role | string } | null | undefined, capability: Capability): boolean {
  return !!user && capabilitiesOf(user.role).includes(capability);
}

export const isStaff = (user: { role?: Role | string } | null | undefined) =>
  !!user && STAFF_ROLES.includes(user.role as Role);

// Legacy roles still pass `@Roles(...)` checks written for the roles they became, and the new roles pass
// checks written for the legacy ones (the import robot's controllers predate the MVP roles).
export const ROLE_ALIASES: Partial<Record<Role, Role[]>> = {
  [Role.MODERATOR]: [Role.SUPPORT_ADMIN],
  [Role.SUPPORT_ADMIN]: [Role.MODERATOR],
  [Role.ADMIN]: [Role.SALES_ADMIN, Role.SUPPORT_ADMIN, Role.MODERATOR],
  [Role.SALES_ADMIN]: [Role.ADMIN, Role.SUPPORT_ADMIN, Role.MODERATOR],
};

export const CAPABILITIES_KEY = 'capabilities';
/** Every listed capability is required. */
export const RequireCapability = (...capabilities: Capability[]) => SetMetadata(CAPABILITIES_KEY, capabilities);
