import { PrismaClient, EquipmentCategory, EquipmentCondition, EquipmentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

let seedN = 42;
const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
function pick<T>(a: T[]): T { return a[Math.floor(rnd() * a.length)]; }
const daysAgo = (n: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return d; };
function addMonths(d: Date, m: number) { const r = new Date(d); const day = r.getUTCDate(); r.setUTCMonth(r.getUTCMonth() + m); if (r.getUTCDate() < day) r.setUTCDate(0); return r; }

const PERMS = [
  'USER_VIEW', 'USER_CREATE', 'USER_UPDATE', 'USER_DEACTIVATE', 'ROLE_ASSIGN',
  'EQUIPMENT_VIEW', 'EQUIPMENT_CREATE', 'EQUIPMENT_UPDATE', 'EQUIPMENT_DELETE', 'EQUIPMENT_ASSIGN', 'EQUIPMENT_TRANSFER',
  'MAINTENANCE_CREATE', 'MAINTENANCE_VIEW', 'HISTORY_VIEW', 'REPORT_VIEW', 'AUDIT_LOG_VIEW', 'DASHBOARD_VIEW', 'MASTERDATA_MANAGE',
];
const ROLES: Record<string, { description: string; perms: string[] }> = {
  Admin: { description: 'Full access including users, roles and audit logs', perms: PERMS },
  'ICT Manager': {
    description: 'Manages equipment, assignments, maintenance and master data',
    perms: ['EQUIPMENT_VIEW', 'EQUIPMENT_CREATE', 'EQUIPMENT_UPDATE', 'EQUIPMENT_ASSIGN', 'EQUIPMENT_TRANSFER', 'MAINTENANCE_CREATE', 'MAINTENANCE_VIEW', 'HISTORY_VIEW', 'REPORT_VIEW', 'DASHBOARD_VIEW', 'MASTERDATA_MANAGE'],
  },
  'ICT Staff': {
    description: 'Day-to-day equipment work and maintenance records',
    perms: ['EQUIPMENT_VIEW', 'EQUIPMENT_ASSIGN', 'MAINTENANCE_CREATE', 'MAINTENANCE_VIEW', 'HISTORY_VIEW', 'DASHBOARD_VIEW'],
  },
  Viewer: { description: 'Read-only access for auditors', perms: ['EQUIPMENT_VIEW', 'MAINTENANCE_VIEW', 'HISTORY_VIEW', 'DASHBOARD_VIEW'] },
};

async function main() {
  for (const key of PERMS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  for (const [name, r] of Object.entries(ROLES)) {
    await prisma.role.upsert({
      where: { name },
      update: { description: r.description, permissions: { set: r.perms.map((key) => ({ key })) } },
      create: { name, description: r.description, permissions: { connect: r.perms.map((key) => ({ key })) } },
    });
  }

  const deptNames = ['ICT', 'Finance', 'Human Resources', 'Operations', 'Procurement', 'Legal'];
  const depts: Record<string, string> = {};
  for (const name of deptNames) depts[name] = (await prisma.department.upsert({ where: { name }, update: {}, create: { name, code: name.slice(0, 3).toUpperCase() } })).id;

  const locNames: Record<string, string> = {
    'ICT Server Room': 'ICT', 'ICT Workshop': 'ICT', 'Finance Office': 'Finance', 'HR Office': 'Human Resources',
    'Operations Floor': 'Operations', 'Procurement Office': 'Procurement', 'Legal Suite': 'Legal', 'Main Reception': 'Operations', 'Central Store': 'ICT',
  };
  const locs: Record<string, string> = {};
  for (const name of Object.keys(locNames)) locs[name] = (await prisma.location.upsert({ where: { name }, update: {}, create: { name } })).id;

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Admin' } });
  const pw = await bcrypt.hash('ChangeMe@12345', 12);
  const adminPw = await bcrypt.hash('Admin@12345', 12);
  const users = [
    { email: 'admin@ict.local', firstName: 'Grace', lastName: 'Okafor', role: 'Admin', dept: 'ICT', hash: adminPw },
    { email: 'manager@ict.local', firstName: 'Daniel', lastName: 'Mensah', role: 'ICT Manager', dept: 'ICT', hash: pw },
    { email: 'staff@ict.local', firstName: 'Amina', lastName: 'Yusuf', role: 'ICT Staff', dept: 'ICT', hash: pw },
    { email: 'viewer@ict.local', firstName: 'Peter', lastName: 'Adeyemi', role: 'Viewer', dept: 'Finance', hash: pw },
  ];
  for (const u of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
    await prisma.user.upsert({
      where: { email: u.email }, update: {},
      create: { email: u.email, firstName: u.firstName, lastName: u.lastName, roleId: role.id, departmentId: depts[u.dept], passwordHash: u.hash, activatedAt: new Date() },
    });
  }
  // one pending member so the invitation states are visible in the demo
  await prisma.user.upsert({
    where: { email: 'new.member@ict.local' }, update: {},
    create: { email: 'new.member@ict.local', firstName: 'Ruth', lastName: 'Bello', roleId: (await prisma.role.findUniqueOrThrow({ where: { name: 'ICT Staff' } })).id, departmentId: depts['ICT'] },
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ict.local' } });

  if ((await prisma.staff.count()) === 0) {
    const people: [string, string, string, string][] = [
      ['Ngozi', 'Eze', 'Finance', 'Accountant'], ['Tunde', 'Bakare', 'Finance', 'Finance Analyst'], ['Fatima', 'Sani', 'Human Resources', 'HR Officer'],
      ['Kwame', 'Asante', 'Human Resources', 'Recruiter'], ['Chidi', 'Obi', 'Operations', 'Operations Lead'], ['Lola', 'Adebayo', 'Operations', 'Coordinator'],
      ['Samuel', 'Owusu', 'Procurement', 'Buyer'], ['Zainab', 'Musa', 'Legal', 'Legal Counsel'], ['Emeka', 'Nwosu', 'ICT', 'Network Engineer'],
      ['Hauwa', 'Ibrahim', 'ICT', 'Support Analyst'], ['Joseph', 'Kamau', 'Finance', 'Auditor'], ['Esther', 'Mbeki', 'Operations', 'Supervisor'],
    ];
    for (const [firstName, lastName, d, position] of people) await prisma.staff.create({ data: { firstName, lastName, position, departmentId: depts[d] } });
  }
  const staff = await prisma.staff.findMany();
  const staffByDept = (deptId: string) => staff.filter((s) => s.departmentId === deptId);

  if ((await prisma.equipment.count()) === 0) {
    const kinds: { cat: EquipmentCategory; code: string; type: string; n: number; makers: [string, string][] }[] = [
      { cat: 'COMPUTER', code: 'PC', type: 'Desktop Computer', n: 14, makers: [['Dell', 'OptiPlex 7090'], ['HP', 'ProDesk 400 G7'], ['Lenovo', 'ThinkCentre M70']] },
      { cat: 'COMPUTER', code: 'LT', type: 'Laptop', n: 12, makers: [['Dell', 'Latitude 5520'], ['HP', 'EliteBook 840 G8'], ['Lenovo', 'ThinkPad T14']] },
      { cat: 'NETWORK', code: 'SW', type: 'Network Switch', n: 6, makers: [['Cisco', 'Catalyst 2960-X'], ['HPE', 'Aruba 2930F'], ['Ubiquiti', 'UniFi US-48']] },
      { cat: 'NETWORK', code: 'RT', type: 'Router', n: 3, makers: [['MikroTik', 'CCR2004'], ['Cisco', 'ISR 4331']] },
      { cat: 'NETWORK', code: 'AP', type: 'Wireless Access Point', n: 5, makers: [['Ubiquiti', 'UniFi U6 Pro'], ['Aruba', 'AP-515']] },
      { cat: 'PRINTER', code: 'PR', type: 'Printer', n: 6, makers: [['HP', 'LaserJet Pro M404'], ['Canon', 'imageCLASS MF445'], ['Brother', 'HL-L6200']] },
      { cat: 'OTHER', code: 'UPS', type: 'UPS', n: 4, makers: [['APC', 'Smart-UPS 1500'], ['Eaton', '5SC 1500']] },
      { cat: 'OTHER', code: 'MN', type: 'Monitor', n: 4, makers: [['Dell', 'P2422H'], ['LG', '24MP60G']] },
    ];
    const types = ['Preventive maintenance', 'Repair', 'Firmware update', 'Cleaning and inspection', 'Battery replacement'];
    const techs = ['John Mwangi', 'David Okoro', 'Amina Yusuf'];
    const deptWithLoc: Record<string, string> = { Finance: 'Finance Office', 'Human Resources': 'HR Office', Operations: 'Operations Floor', Procurement: 'Procurement Office', Legal: 'Legal Suite' };
    let serial = 100234;

    for (const k of kinds) {
      for (let i = 1; i <= k.n; i++) {
        const [manufacturer, model] = pick(k.makers);
        const roll = rnd();
        const status: EquipmentStatus = roll < 0.68 ? 'IN_USE' : roll < 0.77 ? 'UNDER_MAINTENANCE' : roll < 0.84 ? 'FAULTY' : roll < 0.95 ? 'IN_STORAGE' : 'RETIRED';
        const condition: EquipmentCondition =
          status === 'FAULTY' ? pick<EquipmentCondition>(['POOR', 'DAMAGED']) : status === 'RETIRED' ? 'DAMAGED' : pick<EquipmentCondition>(['EXCELLENT', 'EXCELLENT', 'GOOD', 'GOOD', 'GOOD', 'FAIR', 'POOR']);
        const purchaseDate = daysAgo(int(120, 1400));
        const interval = pick([3, 6, 6, 6, 12]);
        const stored = status === 'IN_STORAGE' || status === 'RETIRED';
        const lastMaint = stored && rnd() < 0.5 ? null : daysAgo(int(10, interval * 30 + 20));

        let departmentId: string | null = null, locationId: string | null = null, assignedStaffId: string | null = null;
        if (stored) locationId = locs['Central Store'];
        else if (k.cat === 'NETWORK') { departmentId = depts['ICT']; locationId = locs['ICT Server Room']; }
        else if (k.code === 'UPS') { departmentId = depts['ICT']; locationId = locs['ICT Server Room']; }
        else {
          const dName = pick(Object.keys(deptWithLoc));
          departmentId = depts[dName]; locationId = locs[deptWithLoc[dName]];
          if (k.cat === 'COMPUTER') assignedStaffId = pick(staffByDept(departmentId)).id;
        }

        const eq = await prisma.equipment.create({
          data: {
            assetNumber: `GWL-${k.code}-${String(i).padStart(3, '0')}`, category: k.cat, type: k.type, name: `${manufacturer} ${model}`,
            serialNumber: `SN${serial++}${int(10, 99)}`, manufacturer, model, purchaseDate, status, condition,
            departmentId, locationId, assignedStaffId, lastMaintenanceDate: lastMaint, maintenanceIntervalMonths: interval,
            nextMaintenanceDate: lastMaint ? addMonths(lastMaint, interval) : null,
            notes: status === 'FAULTY' ? 'Reported by user. Awaiting diagnosis.' : null,
          },
        });

        if (!stored) {
          // occasional earlier owner so transfer history is visible
          if (assignedStaffId && rnd() < 0.3) {
            const former = pick(staff.filter((s) => s.departmentId === departmentId && s.id !== assignedStaffId));
            if (former) {
              await prisma.equipmentAssignment.create({ data: { equipmentId: eq.id, staffId: former.id, departmentId, locationId, isCurrent: false, transferDate: purchaseDate, reason: 'Initial assignment', transferredById: admin.id } });
              await prisma.equipmentAssignment.create({ data: { equipmentId: eq.id, staffId: assignedStaffId, previousStaffId: former.id, departmentId, previousDepartmentId: departmentId, locationId, previousLocationId: locationId, isCurrent: true, transferDate: daysAgo(int(10, 90)), reason: `${former.firstName} ${former.lastName} left the department`, transferredById: admin.id } });
            }
          } else {
            await prisma.equipmentAssignment.create({ data: { equipmentId: eq.id, staffId: assignedStaffId, departmentId, locationId, isCurrent: true, transferDate: purchaseDate, reason: 'Initial assignment', transferredById: admin.id } });
          }
        }

        if (lastMaint) {
          const count = int(1, 3);
          for (let c = 0; c < count; c++) {
            const date = c === 0 ? lastMaint : addMonths(lastMaint, -interval * c);
            if (date < purchaseDate) break;
            await prisma.maintenanceRecord.create({
              data: { equipmentId: eq.id, maintenanceDate: date, maintenanceType: pick(types), description: pick(['Routine inspection and clean-up', 'Replaced worn component', 'Applied latest updates', 'Tested and verified performance']), technician: pick(techs), cost: rnd() < 0.4 ? int(15, 220) : null, recordedById: admin.id },
            });
          }
        }
      }
    }
  }

  console.log('\nSeed complete. DEVELOPMENT-ONLY credentials (change before any real deployment):');
  console.log('  admin@ict.local    / Admin@12345');
  console.log('  manager@ict.local  / ChangeMe@12345');
  console.log('  staff@ict.local    / ChangeMe@12345');
  console.log('  viewer@ict.local   / ChangeMe@12345\n');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
