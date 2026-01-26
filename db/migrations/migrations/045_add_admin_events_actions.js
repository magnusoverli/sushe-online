// Add actions column to admin_events table
// Stores available actions (approve/reject/etc.) for each event
module.exports = {
  async up(pool) {
    // Add actions column to store action buttons for each event
    await pool.query(`
      ALTER TABLE admin_events
      ADD COLUMN IF NOT EXISTS actions JSONB DEFAULT '[]'::jsonb
    `);

    // Update existing account_approval events with default actions
    await pool.query(`
      UPDATE admin_events
      SET actions = '[
        {"id": "approve", "label": "✅ Approve"},
        {"id": "reject", "label": "❌ Reject"}
      ]'::jsonb
      WHERE event_type = 'account_approval' AND actions = '[]'::jsonb
    `);
  },

  async down(pool) {
    await pool.query(`
      ALTER TABLE admin_events
      DROP COLUMN IF EXISTS actions
    `);
  },
};
