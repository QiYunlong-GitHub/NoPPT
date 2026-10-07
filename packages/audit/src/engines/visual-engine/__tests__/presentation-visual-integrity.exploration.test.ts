import { describe, expect, it } from 'vitest';
import { formatCounterexamples, runExploration } from './presentation-visual-integrity.exploration';

describe('presentation visual integrity · bug-condition exploration', () => {
  it('records current five-page counterexamples before the fix', async () => {
    const result = await runExploration();

    expect(result.sourceUnchanged, `Target input changed; report: ${result.reportPath}`).toBe(true);
    expect(result.deterministicFailures, `Exploration report: ${result.reportPath}\n${formatCounterexamples(result)}`).not.toEqual([]);
    expect(result.unverified.every((item) => item.code.length > 0), `Unverified environment states are documented in ${result.reportPath}`).toBe(true);
  }, 120_000);
});
