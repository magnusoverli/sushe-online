const RESTORE_ERROR_CODES = Object.freeze({
  NO_FILE_UPLOADED: 'RESTORE_NO_FILE_UPLOADED',
  INVALID_DUMP: 'RESTORE_INVALID_DUMP',
  FILE_TOO_LARGE: 'RESTORE_FILE_TOO_LARGE',
  UPLOAD_FAILED: 'RESTORE_UPLOAD_FAILED',
  IN_PROGRESS: 'RESTORE_IN_PROGRESS',
  OPERATION_NOT_FOUND: 'RESTORE_OPERATION_NOT_FOUND',
  PRECHECK_FAILED: 'RESTORE_PRECHECK_FAILED',
  TOOL_NOT_FOUND: 'RESTORE_TOOL_NOT_FOUND',
  PROCESS_FAILED: 'RESTORE_PROCESS_FAILED',
  TIMEOUT: 'RESTORE_TIMEOUT',
  INTERNAL_ERROR: 'RESTORE_INTERNAL_ERROR',
});

function createRestoreError(code, message, statusCode = 500, details) {
  const error = new Error(message);
  error.name = 'RestoreError';
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isRestoreError(error) {
  return (
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    error.code.startsWith('RESTORE_')
  );
}

function toRestoreHttpError(
  error,
  fallbackMessage = 'Error restoring database'
) {
  if (!isRestoreError(error)) {
    return {
      statusCode: 500,
      body: {
        error: fallbackMessage,
        code: RESTORE_ERROR_CODES.INTERNAL_ERROR,
      },
    };
  }

  const statusCode = error.statusCode || 500;
  const body = {
    error: error.message || fallbackMessage,
    code: error.code,
  };

  if (error.details !== undefined) {
    body.details = error.details;
  }

  return { statusCode, body };
}

module.exports = {
  RESTORE_ERROR_CODES,
  createRestoreError,
  isRestoreError,
  toRestoreHttpError,
};
