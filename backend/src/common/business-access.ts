import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { AuthUser } from './decorators';
import { BusinessMemberRole, Role } from './enums';
import { Capability, can, isStaff } from './permissions';

type HasTeam = { members?: { userId: Types.ObjectId | string; role: BusinessMemberRole }[]; ownerId?: Types.ObjectId | string | null };

/** The caller's role on a business's team, or null. A primary owner from before teams existed counts as owner. */
export function memberRole(business: HasTeam | null | undefined, userId: string | undefined): BusinessMemberRole | null {
  if (!business || !userId) return null;
  const member = business.members?.find((m) => String(m.userId) === userId);
  if (member) return member.role;
  return business.ownerId && String(business.ownerId) === userId ? BusinessMemberRole.OWNER : null;
}

export const isMember = (business: HasTeam | null | undefined, userId: string | undefined) => memberRole(business, userId) !== null;

/**
 * Spec permissions: business staff and owners create, edit and pause offers and edit the profile; only owners
 * buy plans, promote, see invoices and manage the team. Moderators may edit any business; super admins may do
 * everything an owner can.
 */
export type AccessLevel = 'staff' | 'owner';

export function hasBusinessAccess(business: HasTeam, user: Pick<AuthUser, 'userId' | 'role'>, level: AccessLevel): boolean {
  const role = memberRole(business, user.userId);
  if (level === 'staff') return role !== null || can(user, Capability.BUSINESS_EDIT);
  return role === BusinessMemberRole.OWNER || user.role === Role.SUPER_ADMIN;
}

@Injectable()
export class BusinessAccessService {
  constructor(@InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>) {}

  /**
   * Loads a business the caller may act on. `write` refuses changes to a listing frozen by a dispute
   * (except for staff, who resolve it).
   */
  async load(businessId: string, user: AuthUser, level: AccessLevel = 'staff', options: { write?: boolean } = {}): Promise<BusinessDocument> {
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId) : null;
    if (!business) throw new NotFoundException('Business not found');
    if (!hasBusinessAccess(business, user, level)) {
      throw new ForbiddenException(level === 'owner' ? 'Only the business owner can do this' : 'You do not manage this business');
    }
    if (options.write && business.frozen && !isStaff(user)) {
      throw new ForbiddenException('This listing is locked while our team reviews a dispute about who owns it');
    }
    return business;
  }

  /** Every business the user is on the team of, with their role. */
  async mine(userId: string) {
    const id = new Types.ObjectId(userId);
    const businesses = await this.businesses
      .find({ $or: [{ 'members.userId': id }, { ownerId: id }], status: { $ne: 'archived' } })
      .populate('categories', 'name slug emoji')
      .sort({ createdAt: 1 });
    return businesses.map((b) => ({ business: b, role: memberRole(b, userId)! }));
  }
}
