const logger = require('../utils/logger');

// Preserve the published application's Express proxy policy at the public
// boundary. The recovery gateway must not introduce a different access policy.
function configureProxyTrust(app, env = process.env) {
  if (env.TRUST_PROXY) {
    app.set('trust proxy', env.TRUST_PROXY);
    logger.info('Trust proxy enabled via TRUST_PROXY env var', {
      value: env.TRUST_PROXY,
    });
  } else if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    logger.info('Trust proxy auto-enabled for production environment');
  }
}

module.exports = { configureProxyTrust };
