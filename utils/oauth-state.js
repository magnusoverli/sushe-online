const { randomBytes, timingSafeEqual } = require('node:crypto');
const STATE_TTL_MS = 10 * 60 * 1000;

function beginOAuthState(session, provider) {
  const state = randomBytes(32).toString('hex');
  session[`${provider}State`] = state;
  session[`${provider}StateCreatedAt`] = Date.now();
  return state;
}

function consumeOAuthState(session, provider, supplied) {
  const expected = session[`${provider}State`];
  const createdAt = session[`${provider}StateCreatedAt`];
  delete session[`${provider}State`];
  delete session[`${provider}StateCreatedAt`];
  if (
    typeof supplied !== 'string' ||
    typeof expected !== 'string' ||
    !expected ||
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt < 0 ||
    Date.now() - createdAt > STATE_TTL_MS
  )
    return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = { beginOAuthState, consumeOAuthState };
