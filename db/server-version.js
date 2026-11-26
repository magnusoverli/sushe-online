const POSTGRES_MAJOR = 19;
const POSTGRES_BIN = `/usr/lib/postgresql/${POSTGRES_MAJOR}/bin`;

class UnsupportedPostgresError extends Error {}

/** @param {Pick<import('pg').PoolClient, 'query'>} client */
async function requirePostgres19(client) {
  const { rows } = await client.query('SHOW server_version_num');
  const major = Math.floor(Number(rows[0]?.server_version_num) / 10000);
  if (major !== POSTGRES_MAJOR) {
    throw new UnsupportedPostgresError(
      `PostgreSQL ${POSTGRES_MAJOR} is required (detected ${major || 'unknown'}). Complete the database cutover before deploying this image.`
    );
  }
}

module.exports = { POSTGRES_BIN, requirePostgres19, UnsupportedPostgresError };
