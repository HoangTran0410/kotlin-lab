/**
 * Display name of a job, SHARED between the graph and the narration.
 *
 * Priority order, and why:
 *
 * 1. `CoroutineName("x")` — the learner TYPED it out deliberately, and it's a
 *    real element of the CoroutineContext. Whatever's intentional wins.
 * 2. Variable name (`val job = launch { }` -> `job`) — what the learner is
 *    already looking at in their own code, so it's the most natural bridge
 *    between the line of code and the box on the graph.
 * 3. Builder (`launch`) — nothing else left to call it.
 *
 * Id (`j4`) does NOT live here: it's always shown SEPARATELY next to the
 * label, because three unnamed `launch`es have to stay distinguishable from
 * each other even when all three fall through to tier 3.
 */
export function jobLabel(j: {
  id: string; builder: string; name: string | null; varName?: string | null
}): string {
  return j.name ?? j.varName ?? j.builder
}
