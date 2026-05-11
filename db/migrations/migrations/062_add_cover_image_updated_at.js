module.exports = {
  async up(pool) {
    await pool.query(`
      ALTER TABLE albums
      ADD COLUMN IF NOT EXISTS cover_image_updated_at TIMESTAMPTZ
    `);

    await pool.query(`
      UPDATE albums
      SET cover_image_updated_at = COALESCE(updated_at, created_at, NOW())
      WHERE cover_image IS NOT NULL
        AND cover_image_updated_at IS NULL
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE albums
      DROP COLUMN IF EXISTS cover_image_updated_at
    `);
  },
};
