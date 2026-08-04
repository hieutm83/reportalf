import { describe, expect, it } from 'vitest';
import { latestWeekAnchor, reportPeriod } from '../src/periods';

describe('report periods', () => {
  it('uses Saturday-Friday for weekly reports', () => {
    expect(reportPeriod('week', '2026-08-01')).toMatchObject({
      startDate: '2026-07-25', endDate: '2026-07-31', title: 'Tuần 31 ∙ 25/07/2026 - 31/07/2026'
    });
  });

  it('uses the previous complete month when anchored on the first', () => {
    expect(reportPeriod('month', '2026-08-01')).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-31' });
  });

  it('shows the in-progress week after the previous Friday has ended', () => {
    const anchor = latestWeekAnchor('Asia/Bangkok', new Date('2026-08-04T03:00:00Z'));
    expect(anchor).toBe('2026-08-08');
    expect(reportPeriod('week', anchor)).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-07', title: 'Tuần 32 ∙ 01/08/2026 - 07/08/2026' });
  });
});
