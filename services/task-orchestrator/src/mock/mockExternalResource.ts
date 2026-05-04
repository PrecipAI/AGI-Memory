import { randomUUID } from "node:crypto";

export type MockResourceRecord = {
  resourceId: string;
  status: "active" | "deleted";
  createdAt: string;
  payload: Record<string, unknown>;
};

const resourceStore = new Map<string, MockResourceRecord>();

export function createMockExternalResource(payload: Record<string, unknown>): MockResourceRecord {
  const resourceId = `mock-resource-${randomUUID()}`;
  const record: MockResourceRecord = {
    resourceId,
    status: "active",
    createdAt: new Date().toISOString(),
    payload
  };
  resourceStore.set(resourceId, record);
  return record;
}

export function deleteMockExternalResource(resourceId: string): MockResourceRecord | null {
  const current = resourceStore.get(resourceId);
  if (!current) {
    return null;
  }

  const updated: MockResourceRecord = {
    ...current,
    status: "deleted"
  };
  resourceStore.set(resourceId, updated);
  return updated;
}

export function getMockExternalResource(resourceId: string): MockResourceRecord | null {
  return resourceStore.get(resourceId) ?? null;
}
