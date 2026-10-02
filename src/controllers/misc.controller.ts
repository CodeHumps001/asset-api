import { z } from 'zod';
import { prisma } from '../db';
import { dashboardStats } from '../services/equipment.service';
import { audit } from '../utils/audit';
import { asyncHandler, parse, str } from '../utils/http';

export const dashboard = asyncHandler(async (_req, res) => res.json(await dashboardStats()));

export const departments = asyncHandler(async (_req, res) => res.json({ data: await prisma.department.findMany({ orderBy: { name: 'asc' } }) }));
export const locations = asyncHandler(async (_req, res) => res.json({ data: await prisma.location.findMany({ orderBy: { name: 'asc' } }) }));
export const staff = asyncHandler(async (req, res) => {
  const departmentId = str(req.query.departmentId);
  res.json({ data: await prisma.staff.findMany({ where: { isActive: true, ...(departmentId ? { departmentId } : {}) }, include: { department: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }) });
});

export const createDepartment = asyncHandler(async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1), code: z.string().trim().optional() }), req.body);
  const row = await prisma.department.create({ data: body });
  await audit(req, { action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: row.id, description: `Created department ${row.name}` });
  res.status(201).json(row);
});
export const createLocation = asyncHandler(async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1), description: z.string().trim().optional() }), req.body);
  const row = await prisma.location.create({ data: body });
  await audit(req, { action: 'LOCATION_CREATED', entityType: 'Location', entityId: row.id, description: `Created location ${row.name}` });
  res.status(201).json(row);
});
export const createStaff = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({ firstName: z.string().trim().min(1), lastName: z.string().trim().min(1), email: z.string().email().optional(), position: z.string().optional(), departmentId: z.string().uuid() }),
    req.body,
  );
  const row = await prisma.staff.create({ data: body });
  await audit(req, { action: 'STAFF_CREATED', entityType: 'Staff', entityId: row.id, description: `Created staff member ${row.firstName} ${row.lastName}` });
  res.status(201).json(row);
});

export const roles = asyncHandler(async (_req, res) => {
  const rows = await prisma.role.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } });
  res.json({ data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.key) })) });
});
export const permissions = asyncHandler(async (_req, res) => res.json({ data: await prisma.permission.findMany({ orderBy: { key: 'asc' } }) }));

export const auditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
  const q = str(req.query.q);
  const action = str(req.query.action);
  const where = {
    ...(action ? { action } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: 'insensitive' as const } }, { action: { contains: q, mode: 'insensitive' as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);
  res.json({ data: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
});
export const auditActions = asyncHandler(async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  res.json({ data: rows.map((r) => r.action) });
});
