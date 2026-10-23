/**
 * List item comment update helpers.
 *
 * Keeps comment-field update logic centralized so list-service can expose
 * multiple comment endpoints without duplicating transactional SQL flow.
 */

const COMMENT_FIELD_CONFIG = {
  comments: {
    action: 'update comment',
    logMessage: 'Comment updated',
  },
  comments_2: {
    action: 'update comment 2',
    logMessage: 'Comment 2 updated',
  },
};
const { withListTransaction } = require('./transaction');
const { readRevision, checkRevision } = require('./revision');

function createItemComments(deps = {}) {
  const { db, TransactionAbort, findListByIdOrThrow, logger } = deps;

  if (!db) throw new Error('db is required');
  if (!TransactionAbort) throw new Error('TransactionAbort is required');
  if (!findListByIdOrThrow) throw new Error('findListByIdOrThrow is required');

  async function updateItemCommentField(
    listId,
    userId,
    identifier,
    comment,
    field,
    expectedRevision
  ) {
    const fieldConfig = COMMENT_FIELD_CONFIG[field];
    if (!fieldConfig) {
      throw new Error(`Unsupported comment field: ${field}`);
    }

    const trimmedComment = comment ? comment.trim() : null;
    const now = new Date();

    const result = await withListTransaction(db, userId, async (client) => {
      const list = await findListByIdOrThrow(
        listId,
        userId,
        fieldConfig.action,
        client
      );
      if (expectedRevision !== undefined) checkRevision(list, expectedRevision);

      const updateResult = await client.query(
        `UPDATE list_items SET ${field} = $1, updated_at = $2 WHERE list_id = $3 AND album_id = $4 RETURNING _id`,
        [trimmedComment, now, list._id, identifier]
      );

      if (updateResult.rowCount === 0) {
        throw new TransactionAbort(404, {
          error: 'Album not found in list',
        });
      }
      await readRevision(client, list);
      return { listId: list._id, revision: list.revision };
    });

    logger?.info(fieldConfig.logMessage, { userId, listId, identifier });
    return result;
  }

  return {
    updateItemCommentField,
  };
}

module.exports = {
  createItemComments,
};
