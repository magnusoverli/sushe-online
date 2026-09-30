// Released migrations were edited before checksum enforcement existed. Pin
// both sides of each reviewed transition; future edits still fail validation.
// Keep the original recorded checksum as evidence of what actually ran.
/** @type {Record<string, {recorded: string, current: string, requiredMigration?: string, requiredExtension?: string}>} */
const historical = {
  // 30d36b4f: trailing blank line removed; SQL unchanged.
  '005_add_role_column': {
    recorded:
      '115d937e49baf5f9d0aac6577b3867cb2e3ba3179a8d31bcb6672c941e447018',
    current: '22328bb64d8f1830bdf584e65b4a5321715ab15ce3e99912e6aa06647894d1da',
  },
  // e8700d99, 3c121c88, 4bc721bb, 998c7d39 and 9bd13bb1:
  // only irreversible-rollback metadata/comments were subsequently added.
  '011_fix_lastfm_columns': {
    recorded:
      '881e0564d50dfab53eefbaf26a23f03ac06874d1d240293f4607e6be589b8412',
    current: 'c31e3aba40342b6472afa7fde762c87a36518e6c652d24a53e524809dadee97e',
  },
  '027_remove_genre_overrides': {
    recorded:
      '930dedb0fc609e54018b288d0157445d27434125797d0cbca00198a9cee9f42c',
    current: '0746ab6f71b3aa771832789395992090ba987ade96298a5e7d5812fb86df8b07',
  },
  '031_deduplicate_canonical_albums': {
    recorded:
      'f1d3f007bdd6b393fd75b195f93f27813737b1e992644e07444c3daddc97c66c',
    current: '3b9ee5c61f794985d01c7718b30282927a21b9310325fc789a1d3e627640753b',
  },
  '036_upgrade_image_quality': {
    recorded:
      '09b29148510d6dd6e77a3ec9a4281442e1b8cd14874153cb4c78ba48ac5e65b2',
    current: '19ca3e9d566a9c62af5bab1ebb4f33b0877ae35f4a286028012b04c697e55982',
  },
  // 4244dd4c: later added CREATE EXTENSION IF NOT EXISTS pgcrypto.
  '038_add_list_groups': {
    recorded:
      '8369e0ac740a58d1bd4a88e80a04cf04490ea8594b738c8d540f6abf15a92b37',
    current: 'ed98ba0812b6ed2d8716ebba60e87663d52ef675dfc76d76ae0a7a565fcfcebf',
    requiredExtension: 'pgcrypto',
  },
  '039_deduplicate_user_album_stats_lastfm': {
    recorded:
      '9e108f777fdc2f3621cbcc303c0fa04ca1fa9d379ea752166eb7f89e03755b7d',
    current: '815c14ac2ff4e0791124a857e94aba61f28dde3d5f046330bb25c03714254e8a',
  },
  // f55d423f: the subsequent 047 migration supplies the missing index cleanup.
  '046_optimize_album_upsert': {
    recorded:
      '6a13e2c7bab4b211bb2cf65f7086f7aae7d290f2526020f38f72e71eb9362dbf',
    current: 'e8201a545497c1f51fdf9beeb0f8494baf367fdf69601b96c043290210e2f850',
    requiredMigration: '047_fix_conflicting_album_index',
  },
};

/**
 * @param {{version: string, recorded: string, current: string | null,
 * executed: Set<string>, query: (sql: string, values: string[]) => Promise<{rows: Array<{present: boolean}>}>}} options
 */
async function acceptsHistoricalChecksum({
  version,
  recorded,
  current,
  executed,
  query,
}) {
  const entry = historical[version];
  if (!entry || entry.recorded !== recorded || entry.current !== current)
    return false;
  if (entry.requiredMigration && !executed.has(entry.requiredMigration)) {
    throw new Error(
      `Historical migration ${version} requires applied migration ${entry.requiredMigration}`
    );
  }
  if (entry.requiredExtension) {
    const result = await query(
      'SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname=$1) AS present',
      [entry.requiredExtension]
    );
    if (!result.rows[0]?.present)
      throw new Error(
        `Historical migration ${version} requires extension ${entry.requiredExtension}`
      );
  }
  return true;
}

module.exports = { acceptsHistoricalChecksum };
