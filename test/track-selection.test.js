const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Track Selection Logic', () => {
  it('should sort tracks starting from track 1', () => {
    // Simulating the track sorting logic from our fix
    const tracks = [
      '5. Song Five',
      '1. Song One',
      '3. Song Three',
      '2. Song Two',
      '10. Song Ten',
      '4. Song Four',
    ];

    const sortedTracks = [...tracks].sort((a, b) => {
      const aNum = parseInt(
        a.match(/^(\d+)[\.\s\-]/) ? a.match(/^(\d+)/)[1] : 0
      );
      const bNum = parseInt(
        b.match(/^(\d+)[\.\s\-]/) ? b.match(/^(\d+)/)[1] : 0
      );
      if (aNum && bNum) return aNum - bNum;
      return 0;
    });

    assert.strictEqual(sortedTracks[0], '1. Song One');
    assert.strictEqual(sortedTracks[1], '2. Song Two');
    assert.strictEqual(sortedTracks[2], '3. Song Three');
    assert.strictEqual(sortedTracks[3], '4. Song Four');
    assert.strictEqual(sortedTracks[4], '5. Song Five');
    assert.strictEqual(sortedTracks[5], '10. Song Ten');
  });

  it('should handle tracks without numbers', () => {
    const tracks = ['Intro', '1. First Song', 'Interlude', '2. Second Song'];

    const sortedTracks = [...tracks].sort((a, b) => {
      const aNum = parseInt(
        a.match(/^(\d+)[\.\s\-]/) ? a.match(/^(\d+)/)[1] : 0
      );
      const bNum = parseInt(
        b.match(/^(\d+)[\.\s\-]/) ? b.match(/^(\d+)/)[1] : 0
      );
      if (aNum && bNum) return aNum - bNum;
      return 0;
    });

    // Numbered tracks should come in order, unnumbered tracks maintain original order
    assert.strictEqual(sortedTracks[0], 'Intro');
    assert.strictEqual(sortedTracks[1], '1. First Song');
    assert.strictEqual(sortedTracks[2], 'Interlude');
    assert.strictEqual(sortedTracks[3], '2. Second Song');
  });
});
