const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeClusterMembers } = require('../services/duplicates/merge-cluster');

test('cluster merge stops at the first rejected member so its transaction can roll back', async () => {
  const calls = [];
  await assert.rejects(
    mergeClusterMembers('canonical', ['a', 'b', 'c'], async (id) => {
      calls.push(id);
      if (id === 'b') throw new Error('Concurrent mapping conflict');
      return {
        listItemsUpdated: 2,
        albumsDeleted: 1,
        collisionsResolved: 0,
        collisionRowsDeleted: 0,
        taxonomyConflict: false,
        albumTaxonomy: null,
        mappingConflicts: [],
        metadataMerged: true,
        mergedFieldNames: ['summary'],
      };
    }),
    /mapping conflict/
  );
  assert.deepEqual(calls, ['a', 'b']);
});
