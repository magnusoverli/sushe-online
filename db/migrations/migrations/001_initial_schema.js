// Initial database schema migration
module.exports = {
  async up(pool) {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        _id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        reset_token TEXT,
        reset_expires TIMESTAMPTZ,
        spotify_auth JSONB,
        tidal_auth JSONB,
        tidal_country TEXT,
        accent_color TEXT DEFAULT '#dc2626',
        time_format TEXT DEFAULT '24h',
        date_format TEXT DEFAULT 'MM/DD/YYYY',
        music_service TEXT,
        admin_granted_at TIMESTAMPTZ,
        last_activity TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes for users table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_reset_token_expires ON users(reset_token, reset_expires)
    `);

    // Create lists table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lists (
        id SERIAL PRIMARY KEY,
        _id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, name)
      )
    `);

    // Create indexes for lists table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lists_name ON lists(name)
    `);

    // Create list_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS list_items (
        id SERIAL PRIMARY KEY,
        _id TEXT UNIQUE NOT NULL,
        list_id TEXT NOT NULL REFERENCES lists(_id) ON DELETE CASCADE,
        album_id TEXT,
        artist TEXT,
        album TEXT,
        release_date TEXT,
        country TEXT,
        genre_1 TEXT,
        genre_2 TEXT,
        position INTEGER NOT NULL,
        tracks JSONB,
        track_pick TEXT,
        cover_image TEXT,
        cover_image_format TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes for list_items table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items(list_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_list_items_album_id ON list_items(album_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_list_items_position ON list_items(list_id, position)
    `);

    // Create albums table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS albums (
        id SERIAL PRIMARY KEY,
        _id TEXT UNIQUE NOT NULL,
        album_id TEXT UNIQUE,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        release_date TEXT,
        country TEXT,
        genre_1 TEXT,
        genre_2 TEXT,
        tracks JSONB,
        cover_image TEXT,
        cover_image_format TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes for albums table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_albums_album ON albums(album)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_albums_album_id ON albums(album_id)
    `);
  },

  async down(pool) {
    // Drop tables in reverse order due to foreign key constraints
    await pool.query('DROP TABLE IF EXISTS albums CASCADE');
    await pool.query('DROP TABLE IF EXISTS list_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS lists CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
  },
};
