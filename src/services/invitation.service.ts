import { Request } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { config } from '../config';
import { sendMail } from '../emails/mailer';
import { invitationEmail } from '../emails/templates';
import { audit } from '../utils/audit';
import { HttpError } from '../utils/http';
import { hashToken, randomToken } from '../utils/tokens';

/**
 * Creates a fresh single-use invitation (invalidating earlier ones) and emails the activation link.
 * Only a SHA-256 hash of the token is stored. Email is sent synchronously for the MVP; this function is
 * the single place to move into a background job later.
 */
export async function issueInvitation(userId: string, createdById: string | null, req: Request | null, resend = false) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, department: true } });

  await prisma.invitationToken.updateMany({
    where: { userId, usedAt: null, status: { in: ['PENDING', 'SENT', 'FAILED', 'DELIVERED'] } },
    data: { status: 'EXPIRED', expiresAt: new Date() },
  });

  const token = randomToken();
  const inv = await prisma.invitationToken.create({
    data: {
      userId,
      createdById,
      tokenHash: hashToken(token),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + config.invitationHours * 3600 * 1000),
    },
  });

  const mail = invitationEmail({
    name: `${user.firstName} ${user.lastName}`,
    role: user.role.name,
    department: user.department?.name ?? 'Not assigned',
    link: `${config.appUrl}/activate-account?token=${token}`,
    hours: config.invitationHours,
  });

  try {
    await sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
    await prisma.invitationToken.update({ where: { id: inv.id }, data: { status: 'SENT', sentAt: new Date() } });
    await prisma.emailNotification.create({ data: { userId, toEmail: user.email, subject: mail.subject, type: 'INVITATION', status: 'SENT' } });
    await audit(req, {
      action: resend ? 'INVITATION_RESENT' : 'INVITATION_SENT',
      entityType: 'User',
      entityId: userId,
      description: `Invitation ${resend ? 're-sent' : 'sent'} to ${user.email}`,
    });
    return { emailSent: true };
  } catch (e) {
    console.error('[mail] invitation delivery failed', e);
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'Unknown error';
    await prisma.invitationToken.update({ where: { id: inv.id }, data: { status: 'FAILED', lastError: msg } });
    await prisma.emailNotification.create({ data: { userId, toEmail: user.email, subject: mail.subject, type: 'INVITATION', status: 'FAILED', error: msg } });
    await audit(req, { action: 'INVITATION_FAILED', entityType: 'User', entityId: userId, description: `Invitation email to ${user.email} failed` });
    return { emailSent: false };
  }
}

async function findValid(token: string) {
  const inv = await prisma.invitationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true, department: true } } },
  });
  if (!inv || inv.usedAt || inv.status === 'EXPIRED' || inv.expiresAt < new Date()) {
    throw new HttpError(400, 'This invitation link is invalid or has expired. Ask your administrator to send a new one.');
  }
  if (!inv.user.isActive) throw new HttpError(403, 'This account has been deactivated');
  return inv;
}

export async function invitationInfo(token: string) {
  const { user, expiresAt } = await findValid(token);
  return { name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role.name, department: user.department?.name ?? null, expiresAt };
}

export async function activateAccount(token: string, password: string, req: Request) {
  const inv = await findValid(token);
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: inv.userId }, data: { passwordHash, activatedAt: now } }),
    prisma.invitationToken.update({ where: { id: inv.id }, data: { usedAt: now, acceptedAt: now, status: 'ACCEPTED' } }),
  ]);
  await audit(req, { actorId: inv.userId, action: 'INVITATION_ACCEPTED', entityType: 'User', entityId: inv.userId, description: `${inv.user.email} activated their account` });
}
