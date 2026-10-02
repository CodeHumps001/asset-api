import { Request } from 'express';
import { prisma } from '../db';

export async function audit(
  req: Request | null,
  p: { actorId?: string | null; action: string; entityType: string; entityId?: string; description: string },
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: p.actorId ?? req?.user?.id ?? null,
        action: p.action,
        entityType: p.entityType,
        entityId: p.entityId,
        description: p.description,
        ipAddress: req?.ip,
        userAgent: req?.get('user-agent')?.slice(0, 250),
      },
    });
  } catch (e) {
    console.error('[audit] failed to write log', e);
  }
}
