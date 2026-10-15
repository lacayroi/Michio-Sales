import type { Prisma, PrismaClient } from '@michio/db';
import { SETTING_DEFAULTS, type SettingKey, type SettingValues } from '@michio/shared';

type Db = Pick<PrismaClient, 'setting'> | Prisma.TransactionClient;

export async function getSetting<K extends SettingKey>(db: Db, orgId: string, key: K): Promise<SettingValues[K]> {
  const row = await db.setting.findUnique({ where: { orgId_key: { orgId, key } } });
  return (row?.value as SettingValues[K] | undefined) ?? SETTING_DEFAULTS[key];
}

export async function getSettings<K extends SettingKey>(db: Db, orgId: string, keys: K[]): Promise<Pick<SettingValues, K>> {
  const rows = await db.setting.findMany({ where: { orgId, key: { in: keys } } });
  const out = {} as Pick<SettingValues, K>;
  for (const k of keys) {
    const row = rows.find((r) => r.key === k);
    out[k] = (row?.value as SettingValues[K] | undefined) ?? SETTING_DEFAULTS[k];
  }
  return out;
}

export async function setSetting<K extends SettingKey>(db: Db, orgId: string, key: K, value: SettingValues[K]) {
  const json = value as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { orgId_key: { orgId, key } },
    create: { orgId, key, value: json },
    update: { value: json },
  });
}
