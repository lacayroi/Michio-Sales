// Pure selection strategies (SPEC 6.3.2/6.3.4). The engine calls these inside a transaction holding
// the rule's advisory lock, then persists the returned cursor/state.

export interface PickResult<S> {
  userId: string;
  state: S;
}

/**
 * ROUND_ROBIN over the rule's ordered target list. `cursor` is the index to try first; ineligible
 * users are skipped without losing their turn order (SPEC: "bỏ qua người không hợp lệ").
 */
export function pickRoundRobin(targets: readonly string[], cursor: number, eligible: ReadonlySet<string>): PickResult<number> | null {
  const n = targets.length;
  if (!n) return null;
  const start = ((cursor % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    const id = targets[idx]!;
    if (eligible.has(id)) return { userId: id, state: (idx + 1) % n };
  }
  return null;
}

export interface WeightState {
  weights: Record<string, number>;
  current: Record<string, number>;
}

/** WEIGHTED: smooth weighted round-robin (nginx algorithm) — spreads picks evenly by weight. */
export function pickWeighted(
  targets: readonly string[],
  state: WeightState | null | undefined,
  eligible: ReadonlySet<string>,
): PickResult<WeightState> | null {
  const pool = targets.filter((t) => eligible.has(t));
  if (!pool.length) return null;
  const weights = state?.weights ?? {};
  const current = { ...(state?.current ?? {}) };
  const w = (id: string) => Math.max(1, Math.floor(weights[id] ?? 1));
  let total = 0;
  let best: string | null = null;
  for (const id of pool) {
    current[id] = (current[id] ?? 0) + w(id);
    total += w(id);
    if (best === null || current[id]! > current[best]!) best = id;
  }
  current[best!] = current[best!]! - total;
  return { userId: best!, state: { weights, current } };
}

/** LEAST_LOADED: fewest open leads; ties broken by target order. */
export function pickLeastLoaded(
  targets: readonly string[],
  openCounts: ReadonlyMap<string, number>,
  eligible: ReadonlySet<string>,
): PickResult<null> | null {
  let best: string | null = null;
  for (const id of targets) {
    if (!eligible.has(id)) continue;
    if (best === null || (openCounts.get(id) ?? 0) < (openCounts.get(best) ?? 0)) best = id;
  }
  return best ? { userId: best, state: null } : null;
}
