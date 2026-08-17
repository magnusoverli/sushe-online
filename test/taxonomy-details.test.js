const { describe, it } = require('node:test');
const assert = require('node:assert');

const taxonomy = {
  rym: {
    primary_genres: ['Post-Rock', '<script>bad()</script>'],
    secondary_genres: ['Ambient'],
    descriptors: ['Atmospheric', 'Nocturnal'],
    languages: ['English'],
    scenes: ['Canterbury Scene'],
    movements: ['New Wave'],
    source_url:
      'https://rateyourmusic.com/release/album/artist/record/?a=1&b=2',
  },
};

describe('taxonomy-details', () => {
  it('renders all RYM taxonomy groups and a safe source link', async () => {
    const { renderTaxonomyContent } =
      await import('../src/js/modules/album-display/taxonomy-details.js');

    const html = renderTaxonomyContent(taxonomy);

    assert.match(html, /<dl class="album-taxonomy-panel">/);
    assert.match(html, /<dt>Primary<\/dt>/);
    assert.match(html, /Post-Rock, &lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.match(html, /<dt>Secondary<\/dt><dd>Ambient<\/dd>/);
    assert.match(html, /<dt>Descriptors<\/dt><dd>Atmospheric, Nocturnal<\/dd>/);
    assert.match(html, /<dt>Languages<\/dt><dd>English<\/dd>/);
    assert.match(html, /<dt>Scenes<\/dt><dd>Canterbury Scene<\/dd>/);
    assert.match(html, /<dt>Movements<\/dt><dd>New Wave<\/dd>/);
    assert.match(
      html,
      /href="https:\/\/rateyourmusic\.com\/release\/album\/artist\/record\/\?a=1&amp;b=2"/
    );
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  });

  it('renders an unsafe source as non-clickable text', async () => {
    const { renderTaxonomyContent } =
      await import('../src/js/modules/album-display/taxonomy-details.js');
    const html = renderTaxonomyContent({
      rym: {
        primary_genres: ['Rock'],
        secondary_genres: [],
        descriptors: [],
        source_url:
          'https://rateyourmusic.com.evil.test/release/album/artist/record/',
      },
    });

    assert.doesNotMatch(html, /<a /);
    assert.match(html, /<dt>Source<\/dt><dd><span>Unavailable<\/span><\/dd>/);
  });

  it('renders trigger-only desktop and mobile controls without inline taxonomy', async () => {
    const { renderTaxonomyTrigger } =
      await import('../src/js/modules/album-display/taxonomy-details.js');

    const desktop = renderTaxonomyTrigger(taxonomy, {
      albumName: 'Record',
      artist: 'Artist',
    });
    assert.match(desktop, /class="taxonomy-trigger"/);
    assert.match(desktop, /data-album-name="Record"/);
    assert.doesNotMatch(desktop, />Taxonomy</);
    assert.doesNotMatch(desktop, /<details|<dt>|album-taxonomy-panel/);
    assert.match(
      renderTaxonomyTrigger(taxonomy, { mobile: true }),
      /taxonomy-trigger-mobile/
    );
    assert.strictEqual(renderTaxonomyTrigger(null), '');
    assert.strictEqual(renderTaxonomyTrigger({ manual_overrides: {} }), '');
  });
});
