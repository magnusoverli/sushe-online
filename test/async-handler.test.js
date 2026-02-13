const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createAsyncHandler } = require('../middleware/async-handler.js');
const { TransactionAbort } = require('../db/transaction.js');
const { createMockLogger, createMockReq, createMockRes } = require('./helpers');

describe('createAsyncHandler', () => {
  it('should return a function', () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    assert.strictEqual(typeof asyncHandler, 'function');
  });

  it('should return a middleware function from asyncHandler', () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const handler = asyncHandler(async () => {}, 'test action');
    assert.strictEqual(typeof handler, 'function');
  });
});

describe('asyncHandler - successful execution', () => {
  it('should call the handler function normally', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async (rq, rs) => {
      rs.status(200).json({ success: true });
    }, 'test action');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { success: true });
    assert.strictEqual(logger.error.mock.calls.length, 0);
  });

  it('should pass req, res, and next to the handler', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();
    const next = mock.fn();

    let receivedArgs;
    const handler = asyncHandler(async (rq, rs, nx) => {
      receivedArgs = { req: rq, res: rs, next: nx };
    }, 'test');

    await handler(req, res, next);

    assert.strictEqual(receivedArgs.req, req);
    assert.strictEqual(receivedArgs.res, res);
    assert.strictEqual(receivedArgs.next, next);
  });
});

describe('asyncHandler - TransactionAbort handling', () => {
  it('should handle TransactionAbort with correct status and body', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new TransactionAbort(404, { error: 'List not found' });
    }, 'fetch list');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.body, { error: 'List not found' });
    // TransactionAbort should NOT be logged as an error
    assert.strictEqual(logger.error.mock.calls.length, 0);
  });

  it('should handle TransactionAbort with 400 status', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new TransactionAbort(400, { error: 'Invalid input' });
    }, 'create item');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: 'Invalid input' });
  });

  it('should handle TransactionAbort with 409 conflict', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new TransactionAbort(409, {
        error: 'A list with this name already exists',
      });
    }, 'create list');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 409);
    assert.deepStrictEqual(res.body, {
      error: 'A list with this name already exists',
    });
  });
});

describe('asyncHandler - unexpected error handling', () => {
  it('should catch unexpected errors and return 500', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('Database connection failed');
    }, 'fetch lists');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'Error fetch lists' });
    assert.strictEqual(logger.error.mock.calls.length, 1);
  });

  it('should log error with userId from request', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq({ user: { _id: 'user456' } });
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('Something broke');
    }, 'update thing');

    await handler(req, res);

    const logCall = logger.error.mock.calls[0];
    assert.strictEqual(logCall.arguments[0], 'Error update thing');
    assert.strictEqual(logCall.arguments[1].userId, 'user456');
    assert.strictEqual(logCall.arguments[1].error, 'Something broke');
  });

  it('should include listId in log context when req.params.id exists', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq({ params: { id: 'list123' } });
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('DB error');
    }, 'fetch list');

    await handler(req, res);

    const logContext = logger.error.mock.calls[0].arguments[1];
    assert.strictEqual(logContext.listId, 'list123');
  });

  it('should include albumId in log context when req.params.albumId exists', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq({ params: { albumId: 'album789' } });
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('DB error');
    }, 'fetch album');

    await handler(req, res);

    const logContext = logger.error.mock.calls[0].arguments[1];
    assert.strictEqual(logContext.albumId, 'album789');
  });

  it('should include year in log context when req.params.year exists', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq({ params: { year: '2025' } });
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('DB error');
    }, 'fetch aggregate list');

    await handler(req, res);

    const logContext = logger.error.mock.calls[0].arguments[1];
    assert.strictEqual(logContext.year, '2025');
  });

  it('should handle missing user gracefully', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq({ user: undefined });
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('Oops');
    }, 'do thing');

    await handler(req, res);

    assert.strictEqual(res.statusCode, 500);
    const logContext = logger.error.mock.calls[0].arguments[1];
    assert.strictEqual(logContext.userId, undefined);
  });
});

describe('asyncHandler - custom error messages', () => {
  it('should use custom errorMessage when provided', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(
      async () => {
        throw new Error('fail');
      },
      'fetch data',
      { errorMessage: 'Database error' }
    );

    await handler(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'Database error' });
  });

  it('should use default error message when no actionName provided', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();

    const handler = asyncHandler(async () => {
      throw new Error('fail');
    });

    await handler(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'Internal server error' });
  });
});

describe('asyncHandler - headersSent guard', () => {
  it('should not send response if headers already sent', async () => {
    const logger = createMockLogger();
    const asyncHandler = createAsyncHandler(logger);
    const req = createMockReq();
    const res = createMockRes();
    res.headersSent = true;

    const statusSpy = mock.fn();
    res.status = statusSpy;

    const handler = asyncHandler(async () => {
      throw new Error('after streaming started');
    }, 'stream data');

    await handler(req, res);

    // Should log the error but not try to send a response
    assert.strictEqual(logger.error.mock.calls.length, 1);
    assert.strictEqual(statusSpy.mock.calls.length, 0);
  });
});
