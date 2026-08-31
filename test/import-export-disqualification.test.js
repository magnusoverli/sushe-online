const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('disqualification exports', async () => {
  const { buildListCSV, getDisqualificationPDFLabel, getExportPoints } =
    await import('../src/js/modules/import-export.js');

  it('adds CSV fields, preserves zero points, and zeroes disqualified points', () => {
    const csv = buildListCSV([
      { rank: 1, album: 'Eligible', artist: 'Artist', points: 0 },
      {
        rank: 2,
        album: 'Excluded',
        artist: 'Artist',
        points: 25,
        is_disqualified: true,
        disqualification_reason: 'Wrong year, alternate release',
      },
    ]);
    const lines = csv.split('\n');

    assert.match(lines[0], /points,is_disqualified,disqualification_reason/);
    assert.match(lines[1], /,0,false,/);
    assert.match(lines[2], /,0,true,"Wrong year, alternate release"/);
    assert.strictEqual(getExportPoints({ points: 0 }), 0);
    assert.strictEqual(
      getExportPoints({ points: 25, is_disqualified: true }),
      0
    );
  });

  it('builds a visible PDF label with an optional reason', () => {
    assert.strictEqual(getDisqualificationPDFLabel({}), '');
    assert.strictEqual(
      getDisqualificationPDFLabel({ is_disqualified: true }),
      'DISQUALIFIED'
    );
    assert.strictEqual(
      getDisqualificationPDFLabel({
        is_disqualified: true,
        disqualification_reason: 'Duplicate',
      }),
      'DISQUALIFIED - Duplicate'
    );
  });
});
