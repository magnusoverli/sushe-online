function createRestoreOperationService(deps = {}) {
  const now = deps.now || (() => Date.now());
  const operations = new Map();

  const activeStatuses = new Set([
    'received',
    'validating',
    'preflight',
    'dropping',
    'restoring',
    'finalizing',
    'logout_pending',
    'restarting',
  ]);

  function createBaseOperation(input = {}) {
    const timestamp = new Date(now()).toISOString();
    return {
      restoreId: input.restoreId,
      status: 'received',
      actor: input.actor || null,
      clientIp: input.clientIp || null,
      fileSize: input.fileSize || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      details: null,
    };
  }

  function markUpdated(operation) {
    operation.updatedAt = new Date(now()).toISOString();
  }

  function hasActiveRestore() {
    for (const operation of operations.values()) {
      if (activeStatuses.has(operation.status)) {
        return true;
      }
    }
    return false;
  }

  function begin(input = {}) {
    const operation = createBaseOperation(input);
    operations.set(operation.restoreId, operation);
    return { ...operation };
  }

  function setStatus(restoreId, status, details = null) {
    const operation = operations.get(restoreId);
    if (!operation) return null;

    operation.status = status;
    if (details !== null) {
      operation.details = details;
    }

    if (status === 'completed' || status === 'failed') {
      operation.completedAt = new Date(now()).toISOString();
    }

    markUpdated(operation);
    return { ...operation };
  }

  function fail(restoreId, errorCode, errorMessage, details = null) {
    const operation = operations.get(restoreId);
    if (!operation) return null;

    operation.status = 'failed';
    operation.errorCode = errorCode || null;
    operation.errorMessage = errorMessage || null;
    operation.details = details;
    operation.completedAt = new Date(now()).toISOString();
    markUpdated(operation);

    return { ...operation };
  }

  function getOperation(restoreId) {
    const operation = operations.get(restoreId);
    return operation ? { ...operation } : null;
  }

  return {
    begin,
    setStatus,
    fail,
    getOperation,
    hasActiveRestore,
  };
}

module.exports = { createRestoreOperationService };
