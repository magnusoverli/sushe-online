/** Persist only if the connection being refreshed still exists and is unchanged.
 * @param {Pick<import('../types').DbFacade, 'raw'>} db
 * @param {string} userId
 * @param {string} authField
 * @param {object} token
 * @param {string} expectedRefreshToken
 */
async function saveRefreshedToken(
  db,
  userId,
  authField,
  token,
  expectedRefreshToken
) {
  const column =
    authField === 'spotifyAuth'
      ? 'spotify_auth'
      : authField === 'tidalAuth'
        ? 'tidal_auth'
        : null;
  if (!column) throw new Error('Unsupported OAuth provider');
  const result = await db.raw(
    `UPDATE users SET ${column}=$1, updated_at=NOW()
    WHERE _id=$2 AND ${column}->>'refresh_token'=$3 RETURNING _id`,
    [JSON.stringify(token), userId, expectedRefreshToken],
    { name: 'users-repo-save-refreshed-token' }
  );
  return result.rows.length > 0;
}
module.exports = { saveRefreshedToken };
