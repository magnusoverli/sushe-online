// @ts-check
/**
 * Shared JSDoc typedefs for the DB layer.
 *
 * Runtime no-op — this file only exists so that other modules can reference
 * its typedefs via `@typedef` imports for editor tooltips and `// @ts-check`.
 *
 * Shapes are derived from the migration files under db/migrations/migrations
 * and mirrored in the field maps in db/index.js.
 *
 * Keep in sync when columns are added or removed. The canonical source is the
 * migration-owned DB schema; this file is a reflection of it for editor tooling.
 */

/**
 * @typedef {Object} User
 * @property {string} _id
 * @property {string} [email]
 * @property {string} [username]
 * @property {string} [hash]
 * @property {string} [accentColor]
 * @property {string} [timeFormat]
 * @property {string} [dateFormat]
 * @property {string} [lastSelectedList]
 * @property {string} [role]
 * @property {Date} [adminGrantedAt]
 * @property {Object} [spotifyAuth]
 * @property {Object} [tidalAuth]
 * @property {string} [tidalCountry]
 * @property {string} [musicService]
 * @property {string} [resetToken]
 * @property {number} [resetExpires]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 * @property {Date} [lastActivity]
 * @property {Object} [lastfmAuth]
 * @property {string} [lastfmUsername]
 * @property {Date} [listSetupDismissedUntil]
 * @property {string} [approvalStatus]
 * @property {Object} [columnVisibility]
 */

/**
 * @typedef {Object} List
 * @property {string} _id
 * @property {string} userId
 * @property {string} name
 * @property {Object} [data]
 * @property {number} [year]
 * @property {boolean} [isMain]
 * @property {string} [groupId]
 * @property {number} [sortOrder]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

/**
 * @typedef {Object} ListItem
 * @property {string} _id
 * @property {string} listId
 * @property {number} position
 * @property {string} [albumId]
 * @property {string} [comments]
 * @property {string} [comments2]
 * @property {string} [primaryTrack]
 * @property {string} [secondaryTrack]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

/**
 * @typedef {Object} Album
 * @property {number} _id
 * @property {string} albumId
 * @property {string} [artist]
 * @property {string} [album]
 * @property {string} [releaseDate]
 * @property {string} [country]
 * @property {string} [genre1]
 * @property {string} [genre2]
 * @property {Object[]} [tracks]
 * @property {Buffer|string} [coverImage]
 * @property {string} [coverImageFormat]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

/**
 * @typedef {Object} ListGroup
 * @property {string} _id
 * @property {string} userId
 * @property {string} name
 * @property {number} [year]
 * @property {number} [sortOrder]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

/**
 * Options for PgDatastore.raw / .withClient / .withTransaction.
 * @typedef {Object} QueryOpts
 * @property {string} [name]        Prepared-statement name (enables pg's plan cache).
 * @property {boolean} [retryable]  Retry on transient errors (serialization,
 *                                  deadlock, connection loss) via withRetry.
 *                                  Only set to true for idempotent statements.
 */

/**
 * Options for PgDatastore.withTransaction.
 * @typedef {Object} TransactionOpts
 * @property {boolean} [retryable]  Retry the whole transaction on 40001/40P01.
 * @property {'READ UNCOMMITTED'|'READ COMMITTED'|'REPEATABLE READ'|'SERIALIZABLE'} [isolation]
 */

/**
 * Canonical DB facade — the shape of the tableless `db` export from
 * `db/index.js`, plus every tabled PgDatastore instance.
 * @typedef {Object} DbFacade
 * @property {(sql: string, params?: any[], opts?: QueryOpts) => Promise<import('pg').QueryResult>} raw
 * @property {(callback: (client: import('pg').PoolClient) => Promise<*>, opts?: { retryable?: boolean }) => Promise<*>} withClient
 * @property {(callback: (client: import('pg').PoolClient) => Promise<*>, opts?: TransactionOpts) => Promise<*>} withTransaction
 */

module.exports = {};
