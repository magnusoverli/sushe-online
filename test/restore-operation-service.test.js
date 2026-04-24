const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  createRestoreOperationService,
} = require('../services/restore-operation-service');

describe('restore-operation-service', () => {
  it('tracks restore lifecycle status transitions', () => {
    const service = createRestoreOperationService();

    service.begin({
      restoreId: 'restore-1',
      actor: 'admin',
      fileSize: 1234,
    });
    service.setStatus('restore-1', 'restoring');
    service.setStatus('restore-1', 'restarting');

    const operation = service.getOperation('restore-1');
    assert.strictEqual(operation.restoreId, 'restore-1');
    assert.strictEqual(operation.status, 'restarting');
    assert.strictEqual(operation.actor, 'admin');
    assert.strictEqual(operation.fileSize, 1234);
  });

  it('reports active restore state and clears on failure', () => {
    const service = createRestoreOperationService();

    service.begin({ restoreId: 'restore-2' });
    assert.strictEqual(service.hasActiveRestore(), true);

    service.fail('restore-2', 'RESTORE_PROCESS_FAILED', 'restore failed');
    assert.strictEqual(service.hasActiveRestore(), false);

    const operation = service.getOperation('restore-2');
    assert.strictEqual(operation.status, 'failed');
    assert.strictEqual(operation.errorCode, 'RESTORE_PROCESS_FAILED');
  });
});
