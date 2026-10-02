import { Request } from 'express';
import { Prisma, InvitationStatus } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../utils/audit';
import { HttpError } from '../utils/http';
import { issueInvitation } from './invitation.service';

const include = {
  role: true,
  department: true,
  invitations: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof include }>;

export function serializeUser(u: UserRow) {
  const inv = u.invitations[0];
  let invStatus: InvitationStatus = 'PENDING';
  if (u.activatedAt) invStatus = 'ACCEPTED';
  else if (inv) {
    invStatus = inv.status;
    if ((invStatus === 'PENDING' || invStatus === 'SENT') && inv.expiresAt < new Date()) invStatus = 'EXPIRED';
  }
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: { id: u.role.id, name: u.role.name },
    department: u.department ? { id: u.department.id, name: u.department.name } : null,
    isActive: u.isActive,
    accountStatus: !u.isActive ? 'INACTIVE' : u.activatedAt ? 'ACTIVE' : 'PENDING',
    invitation: {
      status: invStatus,
      sentAt: inv?.sentAt ?? null,
      expiresAt: inv?.expiresAt ?? null,
      acceptedAt: u.activatedAt,
    },
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function listUsers(q: { q?: string; roleId?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.UserWhereInput = {};
  if (q.q) {
    const ci = { contains: q.q, mode: 'insensitive' as const };
    where.OR = [{ firstName: ci }, { lastName: ci }, { email: ci }];
  }
  if (q.roleId) where.roleId = q.roleId;
  if (q.status === 'ACTIVE') Object.assign(where, { isActive: true, activatedAt: { not: null } });
  if (q.status === 'INACTIVE') where.isActive = false;
  if (q.status === 'PENDING') Object.assign(where, { isActive: true, activatedAt: null });
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { data: rows.map(serializeUser), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
}

export async function getUser(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, include });
  if (!u) throw new HttpError(404, 'User not found');
  const history = await prisma.invitationToken.findMany({
    where: { userId: id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, status: true, sentAt: true, expiresAt: true, acceptedAt: true, createdAt: true },
  });
  return { ...serializeUser(u), invitationHistory: history };
}

export async function createUser(
  input: { firstName: string; lastName: string; email: string; phone?: string | null; departmentId?: string | null; roleId: string },
  req: Request,
) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'A user with this email address already exists');
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new HttpError(400, 'Selected role does not exist');
  const user = await prisma.user.create({
    data: { firstName: input.firstName, lastName: input.lastName, email, phone: input.phone ?? null, departmentId: input.departmentId ?? null, roleId: input.roleId },
  });
  await audit(req, { action: 'USER_CREATED', entityType: 'User', entityId: user.id, description: `Created user ${email} with role ${role.name}` });
  const { emailSent } = await issueInvitation(user.id, req.user!.id, req);
  return { user: await getUser(user.id), emailSent };
}

export async function updateUser(
  id: string,
  input: { firstName?: string; lastName?: string; phone?: string | null; departmentId?: string | null; roleId?: string },
  req: Request,
) {
  const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) throw new HttpError(404, 'User not found');
  if (input.roleId && input.roleId !== existing.roleId) {
    if (!req.user!.permissions.includes('ROLE_ASSIGN')) throw new HttpError(403, 'You do not have permission to change roles');
    if (id === req.user!.id) throw new HttpError(409, 'You cannot change your own role');
  }
  const updated = await prisma.user.update({ where: { id }, data: input, include: { role: true } });
  await audit(req, { action: 'USER_UPDATED', entityType: 'User', entityId: id, description: `Updated profile of ${updated.email}` });
  if (input.roleId && input.roleId !== existing.roleId) {
    await audit(req, { action: 'ROLE_CHANGED', entityType: 'User', entityId: id, description: `Role of ${updated.email} changed from ${existing.role.name} to ${updated.role.name}` });
  }
  return getUser(id);
}

export async function setActive(id: string, active: boolean, req: Request) {
  if (!active && id === req.user!.id) throw new HttpError(409, 'You cannot deactivate your own account');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'User not found');
  await prisma.user.update({ where: { id }, data: { isActive: active } });
  if (!active) await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(req, {
    action: active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
    entityType: 'User',
    entityId: id,
    description: `${active ? 'Reactivated' : 'Deactivated'} ${user.email}`,
  });
  return getUser(id);
}

export async function resendInvitation(id: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, 'User not found');
  if (user.activatedAt) throw new HttpError(409, 'This member has already activated their account');
  if (!user.isActive) throw new HttpError(409, 'Reactivate this member before sending an invitation');
  const { emailSent } = await issueInvitation(id, req.user!.id, req, true);
  return { user: await getUser(id), emailSent };
}
