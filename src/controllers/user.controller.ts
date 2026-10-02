import { z } from 'zod';
import * as users from '../services/user.service';
import { asyncHandler, parse, str } from '../utils/http';

const emptyToNull = (v: unknown) => (v === '' ? null : v);
const optional = () => z.preprocess(emptyToNull, z.string().trim().nullish());
const optionalId = () => z.preprocess(emptyToNull, z.string().uuid().nullish());

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().email('Enter a valid email address'),
  phone: optional(),
  departmentId: optionalId(),
  roleId: z.string().uuid('Select a role'),
});
const updateSchema = createSchema.omit({ email: true }).partial();

export const list = asyncHandler(async (req, res) => {
  res.json(
    await users.listUsers({
      q: str(req.query.q), roleId: str(req.query.roleId), status: str(req.query.status),
      page: Math.max(1, Number(req.query.page) || 1), pageSize: Math.min(100, Number(req.query.pageSize) || 10),
    }),
  );
});
export const get = asyncHandler(async (req, res) => res.json(await users.getUser(req.params.id)));
export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await users.createUser(parse(createSchema, req.body), req));
});
export const update = asyncHandler(async (req, res) => res.json(await users.updateUser(req.params.id, parse(updateSchema, req.body), req)));
export const deactivate = asyncHandler(async (req, res) => res.json(await users.setActive(req.params.id, false, req)));
export const reactivate = asyncHandler(async (req, res) => res.json(await users.setActive(req.params.id, true, req)));
export const resend = asyncHandler(async (req, res) => res.json(await users.resendInvitation(req.params.id, req)));
