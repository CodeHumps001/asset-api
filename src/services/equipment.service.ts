import { Request } from 'express';
import { Prisma, EquipmentStatus, EquipmentCondition, EquipmentCategory } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { audit } from '../utils/audit';
import { HttpError } from '../utils/http';

const include = { department: true, location: true, assignedStaff: true } satisfies Prisma.EquipmentInclude;

/* ---------- maintenance date helpers (all server-side) ---------- */
export function addMonths(d: Date, months: number) {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + months);
  if (r.getUTCDate() < day) r.setUTCDate(0);
  return r;
}
export const nextDate = (last?: Date | null, months?: number | null) => (last && months ? addMonths(last, months) : null);
export const startOfToday = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

export function maintenanceState(next?: Date | null) {
  if (!next) return { state: 'NONE' as const, daysUntil: null };
  const n = new Date(next);
  n.setUTCHours(0, 0, 0, 0);
  const days = Math.round((n.getTime() - startOfToday().getTime()) / 864e5);
  const state = days < 0 ? 'OVERDUE' : days === 0 ? 'DUE_TODAY' : days <= config.reminderDays ? 'DUE_SOON' : 'OK';
  return { state, daysUntil: days };
}

const withState = <T extends { nextMaintenanceDate: Date | null }>(e: T) => ({ ...e, maintenance: maintenanceState(e.nextMaintenanceDate) });

/* ---------- queries ---------- */
export async function listEquipment(q: Record<string, string | undefined>) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 10));
  const and: Prisma.EquipmentWhereInput[] = [];

  if (q.q) {
    const s = q.q;
    const ci = { contains: s, mode: 'insensitive' as const };
    const or: Prisma.EquipmentWhereInput[] = [
      { assetNumber: ci }, { serialNumber: ci }, { type: ci }, { name: ci }, { manufacturer: ci }, { model: ci },
      { location: { name: ci } }, { department: { name: ci } },
      { assignedStaff: { OR: [{ firstName: ci }, { lastName: ci }] } },
    ];
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length === 2) or.push({ assignedStaff: { firstName: { equals: words[0], mode: 'insensitive' }, lastName: { equals: words[1], mode: 'insensitive' } } });
    const norm = s.toUpperCase().replace(/\s+/g, '_');
    if (norm in EquipmentStatus) or.push({ status: norm as EquipmentStatus });
    if (norm in EquipmentCondition) or.push({ condition: norm as EquipmentCondition });
    and.push({ OR: or });
  }
  if (q.status && q.status in EquipmentStatus) and.push({ status: q.status as EquipmentStatus });
  if (q.condition && q.condition in EquipmentCondition) and.push({ condition: q.condition as EquipmentCondition });
  if (q.category && q.category in EquipmentCategory) and.push({ category: q.category as EquipmentCategory });
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.locationId) and.push({ locationId: q.locationId });

  if (q.due) {
    const t = startOfToday();
    and.push({ status: { not: 'RETIRED' } });
    if (q.due === 'overdue') and.push({ nextMaintenanceDate: { lt: t } });
    else if (q.due === 'today') and.push({ nextMaintenanceDate: { gte: t, lt: addDays(t, 1) } });
    else if (q.due === 'soon') and.push({ nextMaintenanceDate: { gte: t, lte: addDays(t, config.reminderDays) } });
    else and.push({ nextMaintenanceDate: { lte: addDays(t, config.reminderDays) } });
  }

  const where: Prisma.EquipmentWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({ where, include, orderBy: { assetNumber: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { data: rows.map(withState), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export async function getEquipment(id: string) {
  const e = await prisma.equipment.findUnique({ where: { id }, include });
  if (!e) throw new HttpError(404, 'Equipment not found');
  return withState(e);
}

export async function assignmentHistory(id: string) {
  await getEquipment(id);
  return prisma.equipmentAssignment.findMany({
    where: { equipmentId: id },
    orderBy: { transferDate: 'desc' },
    include: {
      staff: true, previousStaff: true, department: true, previousDepartment: true, location: true, previousLocation: true,
      transferredBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function maintenanceHistory(id: string) {
  await getEquipment(id);
  return prisma.maintenanceRecord.findMany({
    where: { equipmentId: id },
    orderBy: { maintenanceDate: 'desc' },
    include: { recordedBy: { select: { id: true, firstName: true, lastName: true } } },
  });
}

/* ---------- commands ---------- */
export type EquipmentInput = {
  assetNumber: string; category: EquipmentCategory; type: string; name: string;
  serialNumber?: string | null; manufacturer?: string | null; model?: string | null; purchaseDate?: Date | null;
  status: EquipmentStatus; condition: EquipmentCondition;
  lastMaintenanceDate?: Date | null; maintenanceIntervalMonths?: number | null; notes?: string | null;
  departmentId?: string | null; locationId?: string | null; assignedStaffId?: string | null;
};

export async function createEquipment(input: EquipmentInput, req: Request) {
  let { departmentId } = input;
  const { locationId, assignedStaffId } = input;
  if (assignedStaffId && !departmentId) {
    departmentId = (await prisma.staff.findUnique({ where: { id: assignedStaffId } }))?.departmentId ?? null;
  }
  const eq = await prisma.$transaction(async (tx) => {
    const e = await tx.equipment.create({
      data: { ...input, departmentId, nextMaintenanceDate: nextDate(input.lastMaintenanceDate, input.maintenanceIntervalMonths) },
    });
    if (departmentId || locationId || assignedStaffId) {
      await tx.equipmentAssignment.create({
        data: { equipmentId: e.id, staffId: assignedStaffId, departmentId, locationId, isCurrent: true, reason: 'Initial assignment', transferredById: req.user!.id },
      });
    }
    return e;
  });
  await audit(req, { action: 'EQUIPMENT_CREATED', entityType: 'Equipment', entityId: eq.id, description: `Created equipment ${eq.assetNumber} (${eq.name})` });
  return getEquipment(eq.id);
}

export async function updateEquipment(id: string, input: Partial<EquipmentInput>, req: Request) {
  const existing = await prisma.equipment.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Equipment not found');
  // Assignment fields are changed only through assign/transfer so history is never skipped.
  const { departmentId: _d, locationId: _l, assignedStaffId: _s, ...data } = input;
  const last = data.lastMaintenanceDate !== undefined ? data.lastMaintenanceDate : existing.lastMaintenanceDate;
  const interval = data.maintenanceIntervalMonths !== undefined ? data.maintenanceIntervalMonths : existing.maintenanceIntervalMonths;
  await prisma.equipment.update({ where: { id }, data: { ...data, nextMaintenanceDate: nextDate(last, interval) } });
  await audit(req, { action: 'EQUIPMENT_UPDATED', entityType: 'Equipment', entityId: id, description: `Updated equipment ${existing.assetNumber}` });
  return getEquipment(id);
}

export async function retireEquipment(id: string, req: Request) {
  const existing = await prisma.equipment.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Equipment not found');
  await prisma.equipment.update({ where: { id }, data: { status: 'RETIRED' } });
  await audit(req, { action: 'EQUIPMENT_RETIRED', entityType: 'Equipment', entityId: id, description: `Retired equipment ${existing.assetNumber}. History has been kept.` });
  return getEquipment(id);
}

export async function reassign(
  id: string,
  input: { staffId?: string | null; departmentId?: string | null; locationId?: string | null; reason?: string | null },
  mode: 'ASSIGN' | 'TRANSFER',
  req: Request,
) {
  const eq = await prisma.equipment.findUnique({ where: { id } });
  if (!eq) throw new HttpError(404, 'Equipment not found');
  if (eq.status === 'RETIRED') throw new HttpError(409, 'Retired equipment cannot be assigned');
  const hasCurrent = (await prisma.equipmentAssignment.count({ where: { equipmentId: id, isCurrent: true } })) > 0;
  if (mode === 'ASSIGN' && hasCurrent) throw new HttpError(409, 'This equipment is already assigned. Use transfer instead.');
  if (mode === 'TRANSFER' && !hasCurrent) throw new HttpError(409, 'This equipment has no current assignment. Use assign instead.');

  const staffId = input.staffId ?? null;
  let departmentId = input.departmentId ?? null;
  if (staffId && !departmentId) departmentId = (await prisma.staff.findUnique({ where: { id: staffId } }))?.departmentId ?? null;
  const locationId = input.locationId ?? null;
  if (!staffId && !departmentId && !locationId) throw new HttpError(400, 'Choose a staff member, department or location');

  await prisma.$transaction(async (tx) => {
    await tx.equipmentAssignment.updateMany({ where: { equipmentId: id, isCurrent: true }, data: { isCurrent: false } });
    await tx.equipmentAssignment.create({
      data: {
        equipmentId: id, staffId, departmentId, locationId, isCurrent: true,
        previousStaffId: eq.assignedStaffId, previousDepartmentId: eq.departmentId, previousLocationId: eq.locationId,
        reason: input.reason ?? null, transferredById: req.user!.id,
      },
    });
    await tx.equipment.update({
      where: { id: id },
      data: { assignedStaffId: staffId, departmentId, locationId, status: eq.status === 'IN_STORAGE' ? 'IN_USE' : eq.status },
    });
  });
  await audit(req, {
    action: mode === 'ASSIGN' ? 'EQUIPMENT_ASSIGNED' : 'EQUIPMENT_TRANSFERRED',
    entityType: 'Equipment', entityId: id,
    description: `${mode === 'ASSIGN' ? 'Assigned' : 'Transferred'} ${eq.assetNumber}${input.reason ? `: ${input.reason}` : ''}`,
  });
  return getEquipment(id);
}

export async function addMaintenance(
  id: string,
  input: { maintenanceDate: Date; maintenanceType: string; description: string; technician: string; cost?: number | null; notes?: string | null; setStatus?: EquipmentStatus | null; setCondition?: EquipmentCondition | null },
  req: Request,
) {
  const eq = await prisma.equipment.findUnique({ where: { id } });
  if (!eq) throw new HttpError(404, 'Equipment not found');
  const { setStatus, setCondition, ...record } = input;
  const last = !eq.lastMaintenanceDate || input.maintenanceDate > eq.lastMaintenanceDate ? input.maintenanceDate : eq.lastMaintenanceDate;
  const rec = await prisma.$transaction(async (tx) => {
    const r = await tx.maintenanceRecord.create({ data: { ...record, equipmentId: id, recordedById: req.user!.id } });
    await tx.equipment.update({
      where: { id },
      data: {
        lastMaintenanceDate: last,
        nextMaintenanceDate: nextDate(last, eq.maintenanceIntervalMonths),
        ...(setStatus ? { status: setStatus } : {}),
        ...(setCondition ? { condition: setCondition } : {}),
      },
    });
    return r;
  });
  await audit(req, { action: 'MAINTENANCE_RECORDED', entityType: 'Equipment', entityId: id, description: `Recorded ${input.maintenanceType} on ${eq.assetNumber} by ${input.technician}` });
  return rec;
}

/* ---------- dashboard ---------- */
export async function dashboardStats() {
  const t = startOfToday();
  const dueWhere: Prisma.EquipmentWhereInput = { status: { not: 'RETIRED' }, nextMaintenanceDate: { lte: addDays(t, config.reminderDays) } };
  const [total, computers, network, printers, underMaintenance, faulty, inStorage, maintenanceDue, systemUsers, activeMembers, dueRows, byStatus, byCondition] = await Promise.all([
    prisma.equipment.count(),
    prisma.equipment.count({ where: { category: 'COMPUTER' } }),
    prisma.equipment.count({ where: { category: 'NETWORK' } }),
    prisma.equipment.count({ where: { category: 'PRINTER' } }),
    prisma.equipment.count({ where: { status: 'UNDER_MAINTENANCE' } }),
    prisma.equipment.count({ where: { status: 'FAULTY' } }),
    prisma.equipment.count({ where: { status: 'IN_STORAGE' } }),
    prisma.equipment.count({ where: dueWhere }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true, activatedAt: { not: null } } }),
    prisma.equipment.findMany({ where: dueWhere, include, orderBy: { nextMaintenanceDate: 'asc' }, take: 8 }),
    prisma.equipment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.equipment.groupBy({ by: ['condition'], _count: { _all: true } }),
  ]);
  return {
    totals: { total, computers, network, printers, underMaintenance, faulty, inStorage, maintenanceDue, systemUsers, activeMembers },
    reminderDays: config.reminderDays,
    maintenanceDueList: dueRows.map(withState),
    byStatus: byStatus.map((r) => ({ key: r.status, count: r._count._all })),
    byCondition: byCondition.map((r) => ({ key: r.condition, count: r._count._all })),
  };
}
