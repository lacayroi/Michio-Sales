import { recordAudit } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, handleError, parseJson, requireApiUser } from '@/lib/api';

// Users toggle between working and busy; OFF/INACTIVE are managed via leave & user admin.
const Body = z.object({ status: z.enum(['AVAILABLE', 'BUSY']) });

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser();
    if (user instanceof NextResponse) return user;
    const body = await parseJson(req, Body);
    if (body instanceof NextResponse) return body;

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { status: body.status } }),
      recordAudit(prisma, {
        orgId: user.orgId,
        actorId: user.id,
        via: 'WEB',
        action: 'user.status',
        entityType: 'User',
        entityId: user.id,
        before: { status: user.status },
        after: { status: body.status },
        ip: clientIp(req),
      }),
    ]);
    return NextResponse.json({ status: body.status });
  } catch (err) {
    return handleError(err);
  }
}
