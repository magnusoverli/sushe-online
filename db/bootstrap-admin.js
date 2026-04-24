const crypto = require('crypto');

function createEnsureAdminUser({ db, logger, bcrypt }) {
  return async function ensureAdminUser() {
    try {
      logger.info('Checking for admin user...');
      const existingAdminResult = await db.raw(
        `SELECT _id, email, username
         FROM users
         WHERE role = 'admin'
         LIMIT 1`,
        []
      );
      const existingAdmin = existingAdminResult.rows[0] || null;
      logger.info('Existing admin user check', { exists: !!existingAdmin });

      if (!existingAdmin) {
        logger.info('Creating admin user...');
        const hash = await bcrypt.hash('admin', 12);
        const now = new Date();
        const newUserId = crypto.randomBytes(12).toString('hex');
        const insertResult = await db.raw(
          `INSERT INTO users (
             _id,
             username,
             email,
             hash,
             accent_color,
             time_format,
             date_format,
             role,
             admin_granted_at,
             music_service,
             created_at,
             updated_at,
             last_activity
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             $9,
             $10,
             $11,
             $12,
             $13
           )
           RETURNING _id, email, username`,
          [
            newUserId,
            'admin',
            'admin@localhost.com',
            hash,
            '#dc2626',
            '24h',
            'MM/DD/YYYY',
            'admin',
            now,
            null,
            now,
            now,
            now,
          ]
        );
        const newUser = insertResult.rows[0];

        logger.info('Created admin user successfully', { userId: newUser._id });
        logger.info('Admin login: email=admin@localhost.com, password=admin');

        const verifyResult = await db.raw(
          `SELECT _id
           FROM users
           WHERE email = $1
           LIMIT 1`,
          ['admin@localhost.com']
        );
        const verifyUser = verifyResult.rows[0] || null;
        logger.debug('Verification - can find admin by email', {
          found: !!verifyUser,
        });
        return;
      }

      logger.debug('Admin user already exists', {
        email: existingAdmin.email,
        username: existingAdmin.username,
      });
    } catch (err) {
      logger.error('Error creating admin user', {
        error: err.message,
        stack: err.stack,
      });
    }
  };
}

module.exports = {
  createEnsureAdminUser,
};
