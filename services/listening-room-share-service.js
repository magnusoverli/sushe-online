const crypto = require('node:crypto');
const { TransactionAbort } = require('../db/transaction');
const {
  createListeningRoomShareRepository,
} = require('../db/repositories/listening-room-share-repository');
const { createListFetchers } = require('./list/fetchers');
const {
  buildListeningRoomPayload,
} = require('../utils/listening-room-payload');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function createListeningRoomShareService(deps = {}) {
  const repository =
    deps.repository || createListeningRoomShareRepository({ db: deps.db });
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const fetchers =
    deps.fetchers ||
    createListFetchers({
      db: deps.db,
      // These dependencies are used by the all-lists/export paths only. Public
      // shares use the same full single-list fetch, never the artwork export.
      fetchRecommendationMaps: async () => new Map(),
      findListById: repository.findListOwner,
      getPointsForPosition: require('../utils/scoring').getPositionPoints,
    });

  async function requireOwner(listId, userId) {
    const owner = await repository.findListOwner(listId);
    if (!owner) throw new TransactionAbort(404, { error: 'List not found' });
    if (owner !== userId)
      throw new TransactionAbort(403, { error: 'Forbidden' });
  }

  async function createOrRenew(listId, userId) {
    await requireOwner(listId, userId);
    const share = await repository.createOrRenew(
      listId,
      userId,
      randomBytes(16).toString('base64url')
    );
    const data = await fetchers.getListByIdWithItems(listId, userId);
    if (!data) throw new TransactionAbort(404, { error: 'List not found' });
    const payload = buildListeningRoomPayload(data, share.expires_at);
    return {
      token: share.token,
      expiresAt: payload.expiresAt,
      songCount: payload.songs.length,
      leftOut: payload.leftOut,
    };
  }

  async function stop(listId, userId) {
    await requireOwner(listId, userId);
    await repository.stop(listId, userId);
  }

  async function getPublicPayload(token) {
    // JS's $ anchor also accepts a final newline; enforce exact length too.
    if (
      typeof token !== 'string' ||
      token.length !== 22 ||
      !TOKEN_PATTERN.test(token)
    )
      return null;
    const share = await repository.findWorking(token);
    if (!share) return null;
    const data = await fetchers.getListByIdWithItems(
      share.list_id,
      share.user_id
    );
    if (!data) return null;
    return buildListeningRoomPayload(data, share.expires_at);
  }

  return { createOrRenew, stop, getPublicPayload };
}

module.exports = { createListeningRoomShareService, TOKEN_PATTERN };
