import { CookieOptions } from 'express';
import { z } from 'zod';
import { config } from '../config';
import * as auth from '../services/auth.service';
import * as invitations from '../services/invitation.service';
import { asyncHandler, parse, passwordSchema, str } from '../utils/http';

const COOKIE = 'refresh_token';
const cookieOpts: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/api/auth',
  maxAge: config.refreshDays * 864e5,
};

export const login = asyncHandler(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const r = await auth.login(email, password, req);
  res.cookie(COOKIE, r.refreshToken, cookieOpts).json({ accessToken: r.accessToken, user: r.user });
});

export const refresh = asyncHandler(async (req, res) => {
  const r = await auth.refresh(req.cookies?.[COOKIE]);
  res.cookie(COOKIE, r.refreshToken, cookieOpts).json({ accessToken: r.accessToken, user: r.user });
});

export const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.cookies?.[COOKIE], req);
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined }).json({ ok: true });
});

export const me = asyncHandler(async (req, res) => {
  res.json(await auth.me(req.user!.id));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  await auth.forgotPassword(email, req);
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  await auth.resetPassword(token, password, req);
  res.json({ message: 'Your password has been updated. You can now sign in.' });
});

export const invitationInfo = asyncHandler(async (req, res) => {
  res.json(await invitations.invitationInfo(str(req.query.token) ?? ''));
});

export const activate = asyncHandler(async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  await invitations.activateAccount(token, password, req);
  res.json({ message: 'Your account is active. You can now sign in.' });
});
