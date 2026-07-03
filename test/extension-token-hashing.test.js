const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const {
  createAuthUtils,
  hashExtensionToken,
  extensionTokenLookup,
  timingSafeEqualHex,
} = require('../services/auth-utils-service');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// A valid raw token is 43 base64url chars (crypto.randomBytes(32).base64url).
function rawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Minimal in-memory extension_tokens store exposing a `.raw` DbFacade that
// understands the hashed SELECT / touch UPDATE the validator issues.
function fakeDb(rows) {
  const touched = [];
  return {
    touched,
    raw(sql, params) {
      if (sql.includes('SELECT') && sql.includes('token_lookup = $1')) {
        const lookup = params[0];
        return Promise.resolve({
          rows: rows.filter((r) => r.token_lookup === lookup && !r.is_revoked),
        });
      }
      if (
        sql.includes('UPDATE extension_tokens') &&
        sql.includes('last_used_at')
      ) {
        touched.push(params[0]);
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  };
}

function rowFor(token, overrides = {}) {
  return {
    id: overrides.id ?? 1,
    user_id: overrides.user_id ?? 'user-1',
    expires_at:
      overrides.expires_at ?? new Date(Date.now() + 86400000).toISOString(),
    is_revoked: overrides.is_revoked ?? false,
    token_hash: hashExtensionToken(token),
    token_lookup: extensionTokenLookup(token),
  };
}

describe('extension token hashing helpers', () => {
  it('hashExtensionToken is a stable 64-char sha256 hex', () => {
    const t = rawToken();
    const h = hashExtensionToken(t);
    assert.strictEqual(h.length, 64);
    assert.strictEqual(h, crypto.createHash('sha256').update(t).digest('hex'));
    assert.strictEqual(h, hashExtensionToken(t));
  });

  it('extensionTokenLookup returns the 8-char prefix', () => {
    const t = rawToken();
    assert.strictEqual(extensionTokenLookup(t), t.slice(0, 8));
  });

  it('timingSafeEqualHex compares equal-length hex safely', () => {
    const a = hashExtensionToken('x');
    assert.strictEqual(timingSafeEqualHex(a, a), true);
    assert.strictEqual(timingSafeEqualHex(a, hashExtensionToken('y')), false);
    assert.strictEqual(timingSafeEqualHex(a, 'short'), false);
  });
});

describe('validateExtensionToken (hashed lookup)', () => {
  const utils = createAuthUtils({ logger: silentLogger });

  it('resolves a stored token to its user and touches last_used_at', async () => {
    const token = rawToken();
    const db = fakeDb([rowFor(token, { id: 7, user_id: 'user-7' })]);
    const userId = await utils.validateExtensionToken(token, db);
    assert.strictEqual(userId, 'user-7');
    assert.deepStrictEqual(db.touched, [7]); // touched by id, not raw token
  });

  it('returns null for a token whose hash does not match a same-prefix row', async () => {
    const stored = rawToken();
    // Different token sharing the same 8-char lookup prefix.
    const attacker = stored.slice(0, 8) + rawToken().slice(8);
    const db = fakeDb([rowFor(stored)]);
    const result = await utils.validateExtensionToken(attacker, db);
    assert.strictEqual(result, null);
  });

  it('returns null for an expired token', async () => {
    const token = rawToken();
    const db = fakeDb([
      rowFor(token, { expires_at: new Date(Date.now() - 1000).toISOString() }),
    ]);
    assert.strictEqual(await utils.validateExtensionToken(token, db), null);
  });

  it('returns null for a malformed token without touching the DB', async () => {
    const db = fakeDb([]);
    assert.strictEqual(
      await utils.validateExtensionToken('too-short', db),
      null
    );
    assert.deepStrictEqual(db.touched, []);
  });
});
