const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { flashMiddleware } = require('../config/session.js');

describe('flashMiddleware', () => {
  it('exposes existing flash messages and clears them from session', () => {
    const req = {
      session: {
        flash: {
          error: ['Invalid credentials'],
        },
      },
    };
    const res = { locals: {} };
    const next = mock.fn();

    flashMiddleware()(req, res, next);

    assert.deepStrictEqual(res.locals.flash, {
      error: ['Invalid credentials'],
    });
    assert.strictEqual(req.session.flash, undefined);
    assert.strictEqual(next.mock.calls.length, 1);
  });

  it('does not create session.flash when no messages exist', () => {
    const req = { session: {} };
    const res = { locals: {} };

    flashMiddleware()(req, res, () => {});

    assert.deepStrictEqual(res.locals.flash, {});
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(req.session, 'flash'),
      false
    );
  });

  it('supports getter and setter semantics without eager session writes', () => {
    const req = { session: {} };
    const res = { locals: {} };

    flashMiddleware()(req, res, () => {});

    assert.deepStrictEqual(req.flash('error'), []);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(req.session, 'flash'),
      false
    );

    req.flash('error', 'First error');
    req.flash('error', 'Second error');

    assert.deepStrictEqual(req.flash('error'), ['First error', 'Second error']);
    assert.deepStrictEqual(req.session.flash.error, [
      'First error',
      'Second error',
    ]);
  });
});
