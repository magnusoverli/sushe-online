function createEnsureAdminUser({ users, logger, bcrypt }) {
  return async function ensureAdminUser() {
    try {
      logger.info('Checking for admin user...');
      const existingAdmin = await users.findOne({ role: 'admin' });
      logger.info('Existing admin user check', { exists: !!existingAdmin });

      if (!existingAdmin) {
        logger.info('Creating admin user...');
        const hash = await bcrypt.hash('admin', 12);
        const newUser = await users.insert({
          username: 'admin',
          email: 'admin@localhost.com',
          hash,
          accent_color: '#dc2626',
          time_format: '24h',
          date_format: 'MM/DD/YYYY',
          role: 'admin',
          admin_granted_at: new Date(),
          music_service: null,
          created_at: new Date(),
          updated_at: new Date(),
          last_activity: new Date(),
        });

        logger.info('Created admin user successfully', { userId: newUser._id });
        logger.info('Admin login: email=admin@localhost.com, password=admin');

        const verifyUser = await users.findOne({
          email: 'admin@localhost.com',
        });
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
