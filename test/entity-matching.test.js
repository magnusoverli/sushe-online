/**
 * Tests for the shared entity-matching layer.
 *
 * Locks the two behaviors that previously hid real matches:
 *   - `&` is treated the same as `And`/`and`
 *   - the diacritic-preserved form is tried first (the accented spelling is
 *     usually the canonical one on the service)
 * plus the generic candidate selector's thresholds and first-result fallback.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  generateQueryForms,
  externalMatchKey,
  nameSimilarity,
  selectBestCandidate,
} = require('../utils/entity-matching');

describe('externalMatchKey', () => {
  it('treats "&" and "And" as equivalent (the Speglas case)', () => {
    assert.strictEqual(
      externalMatchKey('Endarkenment, Being & Death'),
      externalMatchKey('Endarkenment Being And Death')
    );
  });

  it('is diacritic-insensitive', () => {
    assert.strictEqual(
      externalMatchKey('Caminhos de Água'),
      externalMatchKey('Caminhos de Agua')
    );
  });

  it('folds non-decomposable letters (ø→o, æ→ae) so they bridge to ASCII', () => {
    assert.strictEqual(
      externalMatchKey('Det hjemsøkte hjertet'),
      externalMatchKey('Det hjemsokte hjertet')
    );
    assert.strictEqual(
      externalMatchKey('Blodørn'),
      externalMatchKey('Blodorn')
    );
  });

  it('does not strip leading articles (conservative exact key)', () => {
    assert.notStrictEqual(
      externalMatchKey('The Wall'),
      externalMatchKey('Wall')
    );
  });
});

describe('generateQueryForms', () => {
  it('puts the diacritic-preserved form first, stripped as fallback (the Água case)', () => {
    const forms = generateQueryForms('Caminhos de Água');
    assert.strictEqual(forms[0], 'Caminhos de Água');
    assert.ok(
      forms.includes('Caminhos de Agua'),
      'stripped form retained as fallback'
    );
    assert.ok(
      forms.indexOf('Caminhos de Água') < forms.indexOf('Caminhos de Agua')
    );
  });

  it('adds an ASCII fallback for non-decomposable letters (ø→o)', () => {
    const forms = generateQueryForms('Det hjemsøkte hjertet');
    assert.strictEqual(forms[0], 'Det hjemsøkte hjertet'); // native first
    assert.ok(
      forms.includes('Det hjemsokte hjertet'),
      'folded ASCII fallback present'
    );
  });

  it('produces both & and "and" spellings (the Speglas case)', () => {
    const forms = generateQueryForms('Endarkenment Being And Death');
    assert.ok(forms.some((f) => f.includes('&')));
    assert.ok(forms.some((f) => /\band\b/i.test(f)));
  });

  it('swaps & to and in the other direction too', () => {
    const forms = generateQueryForms('Guns & Roses');
    assert.ok(forms.some((f) => /guns and roses/i.test(f)));
  });

  it('adds edition-stripped variants when requested', () => {
    const forms = generateQueryForms('OK Computer (Deluxe Edition)', {
      stripEditions: true,
    });
    assert.ok(forms.some((f) => f.toLowerCase() === 'ok computer'));
  });

  it('returns [] for empty input and de-duplicates', () => {
    assert.deepStrictEqual(generateQueryForms(''), []);
    const forms = generateQueryForms('Plain Title');
    assert.strictEqual(new Set(forms).size, forms.length);
  });
});

describe('nameSimilarity', () => {
  it('scores diacritic/casing variants as identical', () => {
    assert.strictEqual(nameSimilarity('Mötley Crüe', 'MOTLEY CRUE'), 1);
  });

  it('scores &/and variants as identical', () => {
    assert.strictEqual(nameSimilarity('Being & Death', 'Being and Death'), 1);
  });

  it('scores ø/o and æ/ae variants as identical', () => {
    assert.strictEqual(nameSimilarity('Blodørn', 'Blodorn'), 1);
    assert.strictEqual(nameSimilarity('Kjærlighet', 'Kjaerlighet'), 1);
  });

  it('returns 0 when either side is empty', () => {
    assert.strictEqual(nameSimilarity('', 'x'), 0);
    assert.strictEqual(nameSimilarity('x', ''), 0);
  });
});

describe('selectBestCandidate', () => {
  const target = { artist: 'Kaatayra', album: 'Caminhos de Água' };

  it('picks the highest-scoring candidate and reports confidence', () => {
    const { best, isConfident } = selectBestCandidate({
      target,
      candidates: [
        { artist: 'Someone Else', album: 'Other Album' },
        { artist: 'Kaatayra', album: 'Caminhos de Agua' },
      ],
      getArtist: (c) => c.artist,
      getAlbum: (c) => c.album,
    });
    assert.strictEqual(best.candidate.artist, 'Kaatayra');
    assert.strictEqual(isConfident, true);
  });

  it('reports not-confident for a weak match (caller can fall back to first result)', () => {
    const { isConfident } = selectBestCandidate({
      target,
      candidates: [{ artist: 'Totally Different', album: 'Nothing Alike' }],
      getArtist: (c) => c.artist,
      getAlbum: (c) => c.album,
    });
    assert.strictEqual(isConfident, false);
  });

  it('handles empty candidate list', () => {
    const result = selectBestCandidate({
      target,
      candidates: [],
    });
    assert.strictEqual(result.best, null);
    assert.strictEqual(result.isConfident, false);
  });

  it('applies the bonus function to the combined score', () => {
    const withBonus = selectBestCandidate({
      target: { album: 'X' },
      candidates: [{ album: 'X' }],
      getAlbum: (c) => c.album,
      bonus: () => 0.05,
    });
    assert.ok(withBonus.best.combined > withBonus.best.albumScore * 0.7);
  });
});
