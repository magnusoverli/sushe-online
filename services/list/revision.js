const { TransactionAbort } = require('../../db/transaction');

function checkRevision(list, expected) {
  if (expected === undefined || expected === null) {
    throw new TransactionAbort(428, {
      error: 'Reload this list before saving.',
      code: 'LIST_REVISION_REQUIRED',
    });
  }
  if (String(expected) !== String(list.revision)) {
    throw new TransactionAbort(412, {
      error:
        'This list changed on another device. Your edits were not saved; reload and reconcile them before retrying.',
      code: 'LIST_CONFLICT',
    });
  }
}

async function readRevision(client, list) {
  const { rows } = await client.query(
    'SELECT revision FROM lists WHERE _id = $1',
    [list._id]
  );
  list.revision = String(rows[0].revision);
}

module.exports = { checkRevision, readRevision };
