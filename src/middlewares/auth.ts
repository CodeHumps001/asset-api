import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import { asyncHandler, HttpError } from '../utils/http';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** 1) token valid  2) account exists and is active. Permissions are always read from the database. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');
  let sub: string;
  try {
    sub = (jwt.verify(header.slice(7), config.jwtSecret) as { sub: string }).sub;
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  const user = await prisma.user.findUnique({ where: { id: sub }, include: { role: { include: { permissions: true } } } });
  if (!user || !user.isActive || !user.passwordHash) throw new HttpError(401, 'This account is not active');
  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    permissions: user.role.permissions.map((p) => p.key),
  };
  next();
});

/** 3) user holds every required permission. */
export const requirePermission =
  (...needed: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    if (!needed.every((p) => req.user!.permissions.includes(p))) {
      throw new HttpError(403, 'You do not have permission to perform this action');
    }
    next();
  };
