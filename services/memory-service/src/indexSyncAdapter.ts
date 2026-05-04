import { getPersistableRecordsForIndex } from "@super-agent/db";

const localIndex = new Map<string, Record<string, unknown>>();

export class IndexSyncAdapter {
  async sync(input: {
    tenantId: string;
    scope: string;
    fingerprint?: string | null;
  }) {
    const persistable = await getPersistableRecordsForIndex({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprint: input.fingerprint
    });

    const nextKeys = new Set<string>();
    const syncedMemoryIds: string[] = [];
    const syncedSkillIds: string[] = [];

    for (const row of persistable.memory) {
      const key = `memory:${row.id}`;
      nextKeys.add(key);
      localIndex.set(key, row);
      syncedMemoryIds.push(String(row.id));
    }

    for (const row of persistable.skill.filter((item) => item.fingerprint_requirement)) {
      const key = `skill:${row.id}`;
      nextKeys.add(key);
      localIndex.set(key, row);
      syncedSkillIds.push(String(row.id));
    }

    const staleIndexIds: string[] = [];
    for (const key of [...localIndex.keys()]) {
      if (!nextKeys.has(key)) {
        staleIndexIds.push(key);
        localIndex.delete(key);
      }
    }

    return {
      backend: "local-fallback",
      synced_memory_ids: syncedMemoryIds,
      synced_skill_ids: syncedSkillIds,
      stale_index_ids: staleIndexIds,
      index_size: localIndex.size
    };
  }
}
