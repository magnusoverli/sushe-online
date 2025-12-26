// Admin events and Telegram configuration tables
// Supports the admin event system with optional Telegram notifications
module.exports = {
  async up(pool) {
    // Create admin_events table
    // Stores events that require admin action (account approvals, reports, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        data JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'normal',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT REFERENCES users(_id) ON DELETE SET NULL,
        resolved_via VARCHAR(20),
        telegram_message_id BIGINT,
        telegram_chat_id BIGINT
      )
    `);

    // Indexes for admin_events
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_events_status ON admin_events(status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_events_type ON admin_events(event_type)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON admin_events(created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_events_pending ON admin_events(status, created_at DESC) WHERE status = 'pending'
    `);

    // Create telegram_config table
    // Stores Telegram bot configuration for admin notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_config (
        id SERIAL PRIMARY KEY,
        bot_token_encrypted TEXT,
        chat_id BIGINT,
        thread_id BIGINT,
        chat_title VARCHAR(255),
        topic_name VARCHAR(255),
        webhook_secret UUID DEFAULT gen_random_uuid(),
        enabled BOOLEAN DEFAULT false,
        configured_at TIMESTAMPTZ,
        configured_by TEXT REFERENCES users(_id) ON DELETE SET NULL
      )
    `);

    // Create telegram_admins table
    // Maps Telegram user IDs to app admin users for action attribution
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_admins (
        id SERIAL PRIMARY KEY,
        telegram_user_id BIGINT UNIQUE NOT NULL,
        telegram_username VARCHAR(255),
        user_id TEXT REFERENCES users(_id) ON DELETE CASCADE,
        linked_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_telegram_admins_user_id ON telegram_admins(user_id)
    `);
  },

  async down(pool) {
    await pool.query('DROP TABLE IF EXISTS telegram_admins CASCADE');
    await pool.query('DROP TABLE IF EXISTS telegram_config CASCADE');
    await pool.query('DROP TABLE IF EXISTS admin_events CASCADE');
  },
};
