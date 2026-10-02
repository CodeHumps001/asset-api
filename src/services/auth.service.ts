import { Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import { sendMail } from '../emails/mailer';
import { resetEmail } from '../emails/templates';
import { audit } from '../utils/audit';
import { HttpError } from '../utils/http';
import { hashToken, randomToken } from '../utils/tokens';

const profileInclude = { role: { include: { permissions: true } }, department: true } as const;

type FullUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;
const loadUser = (id: string) => prisma.user.findUnique({ where: { id }, include: profileInclude });

export function toProfile(u: FullUser) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role.name,
    department: u.department?.name ?? null,
    permissions: u.role.permissions.map((p) => p.key),
  };
}

async function issueTokens(userId: string) {
  const accessToken = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + config.refreshDays * 864e5) },
  });
  return { accessToken, refreshToken };
}

export async function login(email: string, password: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: profileInclude });
  const ok = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !ok) {
    await audit(req, { actorId: user?.id ?? null, action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id, description: `Failed login attempt for ${email}` });
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (!user.isActive) {
    await audit(req, { actorId: user.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, description: `Deactivated account ${email} tried to sign in` });
    throw new HttpError(403, 'This account has been deactivated. Contact your administrator.');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(req, { actorId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, description: `${user.email} signed in` });
  return { ...(await issueTokens(user.id)), user: toProfile(user) };
}

export async function refresh(token: string | undefined) {
  if (!token) throw new HttpError(401, 'No session');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) throw new HttpError(401, 'Session expired');
  const user = await loadUser(row.userId);
  if (!user || !user.isActive || !user.passwordHash) throw new HttpError(401, 'Account is not active');
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } }); // rotation
  return { ...(await issueTokens(user.id)), user: toProfile(user) };
}

export async function logout(token: string | undefined, req: Request) {
  if (!token) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (row && !row.revokedAt) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await audit(req, { actorId: row.userId, action: 'LOGOUT', entityType: 'User', entityId: row.userId, description: 'User signed out' });
  }
}

export async function me(id: string) {
  const u = await loadUser(id);
  if (!u) throw new HttpError(404, 'User not found');
  return toProfile(u);
}

export async function forgotPassword(email: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive || !user.passwordHash) return; // never reveal whether an account exists
  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + config.resetMinutes * 60000) },
  });
  const mail = resetEmail({ name: user.firstName, link: `${config.appUrl}/reset-password?token=${token}`, minutes: config.resetMinutes });
  try {
    await sendMail({ to: user.email, ...mail });
    await prisma.emailNotification.create({ data: { userId: user.id, toEmail: user.email, subject: mail.subject, type: 'PASSWORD_RESET', status: 'SENT' } });
  } catch (e) {
    console.error('[mail] reset email failed', e);
    await prisma.emailNotification.create({ data: { userId: user.id, toEmail: user.email, subject: mail.subject, type: 'PASSWORD_RESET', status: 'FAILED', error: String(e).slice(0, 300) } });
  }
  await audit(req, { actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id, description: `Password reset requested for ${user.email}` });
}

export async function resetPassword(token: string, password: string, req: Request) {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, 'This reset link is invalid or has expired');
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, { actorId: row.userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: row.userId, description: `${row.user.email} reset their password` });
}
