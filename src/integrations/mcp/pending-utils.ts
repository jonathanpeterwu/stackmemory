export interface PendingItem {
  approvalId: string;
  task: string;
  createdAt: number | null;
}

export interface PendingFilters {
  taskContains?: string;
  olderThanMs?: number;
  newerThanMs?: number;
  sort?: 'asc' | 'desc';
  limit?: number;
}

export function filterPending(
  items: PendingItem[],
  filters: PendingFilters = {},
  now: number = Date.now()
): PendingItem[] {
  let out = [...items];
  const { taskContains, olderThanMs, newerThanMs, sort, limit } = filters;

  if (taskContains) {
    const q = taskContains.toLowerCase();
    out = out.filter((it) => (it.task || '').toLowerCase().includes(q));
  }
  if (typeof olderThanMs === 'number') {
    out = out.filter(
      (it) =>
        typeof it.createdAt === 'number' &&
        now - (it.createdAt as number) > olderThanMs
    );
  }
  if (typeof newerThanMs === 'number') {
    out = out.filter(
      (it) =>
        typeof it.createdAt === 'number' &&
        now - (it.createdAt as number) < newerThanMs
    );
  }
  // Treat null timestamps as Infinity (sort last in asc, first in desc)
  const getTs = (t: number | null) => (t === null ? Infinity : t);
  if (sort === 'asc')
    out.sort((a, b) => getTs(a.createdAt) - getTs(b.createdAt));
  if (sort === 'desc')
    out.sort((a, b) => getTs(b.createdAt) - getTs(a.createdAt));
  if (typeof limit === 'number') out = out.slice(0, limit);
  return out;
}
