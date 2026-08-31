function createImportOne({ listService, invalidateListCaches, logger }) {
  return async (entry, adminUser, previewHash) => {
    try {
      const created = await listService.createList(entry.targetUserId, {
        name: entry.listName,
        year: entry.year,
        albums: entry.albums,
        isMain: true,
      });
      invalidateListCaches(entry.targetUserId, null, { groups: true });
      logger.info('Admin imported historical list', {
        adminUserId: adminUser?._id,
        targetUserId: entry.targetUserId,
        listId: created.listId,
        listName: entry.listName,
        year: entry.year,
        albumCount: entry.albumCount,
        previewHash,
      });
      return {
        clientId: entry.clientId,
        status: 'imported',
        listId: created.listId,
      };
    } catch (error) {
      logger.error('Historical list import failed', {
        adminUserId: adminUser?._id,
        targetUserId: entry.targetUserId,
        listName: entry.listName,
        year: entry.year,
        error: error.message,
      });
      return {
        clientId: entry.clientId,
        status: 'failed',
        error: error.userFacingMessage || error.message || 'Import failed',
      };
    }
  };
}

async function commitSequentially({
  rawImports,
  users,
  normalizeImport,
  importOne,
  adminUser,
  previewHash,
}) {
  const results = [];
  for (const rawEntry of rawImports) {
    // Resolve after each commit so later files reuse albums created in this batch.
    const entry = await normalizeImport(rawEntry, users);
    if (entry.errors.length > 0) {
      results.push({
        clientId: entry.clientId,
        status: 'failed',
        error: entry.errors.join('; '),
      });
      continue;
    }
    results.push(await importOne(entry, adminUser, previewHash));
  }
  return results;
}

module.exports = { createImportOne, commitSequentially };
