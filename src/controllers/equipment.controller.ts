import { z } from 'zod';
import { EquipmentCategory, EquipmentCondition, EquipmentStatus } from '@prisma/client';
import * as svc from '../services/equipment.service';
import { asyncHandler, parse } from '../utils/http';

const emptyToNull = (v: unknown) => (v === '' ? null : v);
const s = () => z.preprocess(emptyToNull, z.string().trim().nullish());
const d = () => z.preprocess(emptyToNull, z.coerce.date().nullish());
const id = () => z.preprocess(emptyToNull, z.string().uuid().nullish());

const base = z.object({
  assetNumber: z.string().trim().min(1, 'Asset number is required'),
  category: z.nativeEnum(EquipmentCategory),
  type: z.string().trim().min(1, 'Equipment type is required'),
  name: z.string().trim().min(1, 'Name or description is required'),
  serialNumber: s(), manufacturer: s(), model: s(), purchaseDate: d(),
  status: z.nativeEnum(EquipmentStatus).default('IN_USE'),
  condition: z.nativeEnum(EquipmentCondition).default('GOOD'),
  lastMaintenanceDate: d(),
  maintenanceIntervalMonths: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(120).nullish()),
  notes: s(),
});
const createSchema = base.extend({ departmentId: id(), locationId: id(), assignedStaffId: id() });
const updateSchema = base.partial();
const assignSchema = z.object({ staffId: id(), departmentId: id(), locationId: id(), reason: s() });
const maintenanceSchema = z.object({
  maintenanceDate: z.coerce.date(),
  maintenanceType: z.string().trim().min(1, 'Maintenance type is required'),
  description: z.string().trim().min(1, 'Description is required'),
  technician: z.string().trim().min(1, 'Technician is required'),
  cost: z.preprocess(emptyToNull, z.coerce.number().min(0).nullish()),
  notes: s(),
  setStatus: z.preprocess(emptyToNull, z.nativeEnum(EquipmentStatus).nullish()),
  setCondition: z.preprocess(emptyToNull, z.nativeEnum(EquipmentCondition).nullish()),
});

export const list = asyncHandler(async (req, res) => res.json(await svc.listEquipment(req.query as Record<string, string | undefined>)));
export const get = asyncHandler(async (req, res) => res.json(await svc.getEquipment(req.params.id)));
export const create = asyncHandler(async (req, res) => res.status(201).json(await svc.createEquipment(parse(createSchema, req.body), req)));
export const update = asyncHandler(async (req, res) => res.json(await svc.updateEquipment(req.params.id, parse(updateSchema, req.body), req)));
export const retire = asyncHandler(async (req, res) => res.json(await svc.retireEquipment(req.params.id, req)));
export const history = asyncHandler(async (req, res) => res.json({ data: await svc.assignmentHistory(req.params.id) }));
export const maintenanceList = asyncHandler(async (req, res) => res.json({ data: await svc.maintenanceHistory(req.params.id) }));
export const maintenanceCreate = asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addMaintenance(req.params.id, parse(maintenanceSchema, req.body), req)));
export const assign = asyncHandler(async (req, res) => res.json(await svc.reassign(req.params.id, parse(assignSchema, req.body), 'ASSIGN', req)));
export const transfer = asyncHandler(async (req, res) => res.json(await svc.reassign(req.params.id, parse(assignSchema, req.body), 'TRANSFER', req)));
