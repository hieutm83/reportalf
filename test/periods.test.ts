import { describe, expect, it } from 'vitest';
import { reportPeriod } from '../src/periods';

describe('report periods', () => {
  it('uses Saturday-Friday for weekly reports', () => {
    expect(reportPeriod('week', '2026-08-01')).toMatchObject({
      startDate: '2026-07-25', endDate: '2026-07-31', title: 'Tuần 31 ∙ 25/07/2026 - 31/07/2026'
    });
  });

  it('uses the previous complete month when anchored on the first', () => {
    expect(reportPeriod('month', '2026-08-01')).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-31' });
  });
});
