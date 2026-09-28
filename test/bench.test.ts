import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark } from '../src/bench/layers.ts';

test('layered benchmark: every layer passes (higher layers trusted only after lower ones)', () => {
  const res = runBenchmark();
  assert.equal(res.length, 15); // explicitly replaced: Layer 3.5 (emergent reachability) added in the second-generation upgrade
  const failed = res.flatMap((l) => l.checks.filter((c) => !c.pass).map((c) => `L${l.layer} ${c.id}: ${c.error ?? JSON.stringify(c.evidence)?.slice(0, 300)}`));
  assert.deepEqual(failed, []);
  assert.ok(res.every((l) => l.status === 'pass'));
});
