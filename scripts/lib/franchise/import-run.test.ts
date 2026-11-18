import { describe, expect, it } from 'vitest';
import { parseImportArgs } from './import-run.js';

describe('parseImportArgs', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  it('reads the flags, with defaults', () => {
    expect(parseImportArgs(['--dry-run', '--only=draft', '--cap-mb=300', '--from=2017'], now)).toMatchObject({
      dryRun: true, allowGaps: false, only: 'draft', capMb: 300, from: 2017, to: 2026, currentDraftYear: 2027,
      report: 'data/franchise-report.json', dir: 'data/franchise-raw',
    });
  });

  it('rejects a value on a boolean flag, so a dry run can never turn into a real one', () => {
    expect(() => parseImportArgs(['--dry-run=true'], now)).toThrow(/takes no value/);
    expect(() => parseImportArgs(['--dry-run=false'], now)).toThrow(/takes no value/);
    expect(() => parseImportArgs(['--allow-gaps=1'], now)).toThrow(/takes no value/);
  });

  it('requires = on value flags, and rejects unknown ones', () => {
    expect(() => parseImportArgs(['--only'], now)).toThrow(/needs a value/);
    expect(() => parseImportArgs(['--report='], now)).toThrow(/needs a value/);
    expect(() => parseImportArgs(['--only=bogus'], now)).toThrow(/Invalid --only/);
    expect(() => parseImportArgs(['--dryrun'], now)).toThrow(/Unknown argument/);
  });

  it('starts the next season in July, like seasonOfDate and the draft year', () => {
    expect(parseImportArgs([], new Date('2026-06-30T12:00:00Z'))).toMatchObject({ to: 2025, currentDraftYear: 2026 });
    expect(parseImportArgs([], new Date('2026-07-01T12:00:00Z'))).toMatchObject({ to: 2026, currentDraftYear: 2027 });
  });
});
