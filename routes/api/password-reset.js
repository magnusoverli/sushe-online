/**
 * Password Reset Routes
 *
 * Handles forgot password and reset password flows:
 * - Forgot password page and form submission
 * - Reset password page and form submission
 * - Email delivery via Resend or SendGrid
 */

/**
 * Register password reset routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    logger,
    crypto,
    bcrypt,
    authService,
    nodemailer,
    csrfProtection,
    forgotPasswordRateLimit,
    resetPasswordRateLimit,
    htmlTemplate,
    forgotPasswordTemplate,
    invalidTokenTemplate,
    resetPasswordTemplate,
    composeForgotPasswordEmail,
    isValidPassword,
  } = deps;

  const passwordValidator =
    typeof isValidPassword === 'function'
      ? isValidPassword
      : (password) => typeof password === 'string' && password.length >= 8;

  if (!authService) {
    throw new Error('password-reset routes require authService');
  }

  const getUserByEmail = authService.getUserByEmail.bind(authService);
  const issuePasswordResetToken =
    authService.issuePasswordResetToken.bind(authService);
  const getUserByResetToken = authService.getUserByResetToken.bind(authService);
  const resetPasswordByToken =
    authService.resetPasswordByToken.bind(authService);

  // Forgot password page
  app.get('/forgot', csrfProtection, (req, res) => {
    res.send(
      htmlTemplate(
        forgotPasswordTemplate(req, res.locals.flash || {}),
        'Password Recovery - Black Metal Auth'
      )
    );
  });

  // Handle forgot password submission
  app.post(
    '/forgot',
    forgotPasswordRateLimit,
    csrfProtection,
    async (req, res) => {
      const { email } = req.body;

      if (!email) {
        req.flash('error', 'Please provide an email address');
        return res.redirect('/forgot');
      }

      try {
        const user = await getUserByEmail(email);

        // Always show the same message for security reasons
        req.flash(
          'info',
          'If that email exists, you will receive a reset link'
        );

        if (!user) {
          // Don't reveal that the email doesn't exist
          return res.redirect('/forgot');
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expires = Date.now() + 3600000; // 1 hour

        const numReplaced = await issuePasswordResetToken(
          user._id,
          token,
          expires
        );

        if (numReplaced === 0) {
          logger.error('No user updated when setting reset token');
          // Don't show error to user for security reasons
          return res.redirect('/forgot');
        }

        logger.info('Reset token set for user', { email: user.email });

        // Support both Resend and SendGrid for email delivery
        // Prefer Resend if RESEND_API_KEY is set, otherwise fall back to SendGrid
        if (process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY) {
          const useResend = !!process.env.RESEND_API_KEY;
          const serviceName = useResend ? 'Resend' : 'SendGrid';

          const transporter = nodemailer.createTransport({
            host: useResend ? 'smtp.resend.com' : 'smtp.sendgrid.net',
            port: 587,
            auth: {
              user: useResend ? 'resend' : 'apikey',
              pass: process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY,
            },
          });

          logger.info(`Email service configured: ${serviceName}`);

          const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
          const emailOptions = composeForgotPasswordEmail(user.email, resetUrl);

          // Send email async without waiting (fire-and-forget with logging)
          transporter.sendMail(emailOptions).then(
            () => {
              logger.info(
                `Password reset email sent successfully via ${serviceName}`,
                { email: user.email }
              );
            },
            (error) => {
              logger.error(
                `Failed to send password reset email via ${serviceName}:`,
                error.message
              );
            }
          );
        } else {
          logger.warn(
            'No email service configured (RESEND_API_KEY or SENDGRID_API_KEY required) - password reset email not sent'
          );
          logger.debug('Reset token for testing', { token });
        }

        res.redirect('/forgot');
      } catch (err) {
        logger.error('Database error during forgot password', {
          error: err.message,
        });
        req.flash('error', 'An error occurred. Please try again.');
        return res.redirect('/forgot');
      }
    }
  );

  // Reset password page
  app.get('/reset/:token', csrfProtection, async (req, res) => {
    try {
      const user = await getUserByResetToken(req.params.token);
      if (!user) {
        return res.send(
          htmlTemplate(
            invalidTokenTemplate(),
            'Invalid Token - Black Metal Auth'
          )
        );
      }

      res.send(
        htmlTemplate(
          resetPasswordTemplate(req.params.token, req.csrfToken()),
          'Reset Password - Black Metal Auth'
        )
      );
    } catch (err) {
      logger.error('Reset page token lookup failed', { error: err.message });
      return res.send(
        htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth')
      );
    }
  });

  // Handle password reset
  app.post(
    '/reset/:token',
    resetPasswordRateLimit,
    csrfProtection,
    async (req, res) => {
      try {
        const user = await getUserByResetToken(req.params.token);

        if (!user) {
          return res.send(
            htmlTemplate(
              invalidTokenTemplate(),
              'Invalid Token - Black Metal Auth'
            )
          );
        }

        if (!passwordValidator(req.body.password)) {
          req.flash('error', 'Password must be at least 8 characters long');
          return res.redirect('/reset/' + req.params.token);
        }

        const hash = await bcrypt.hash(req.body.password, 12);

        const numReplaced = await resetPasswordByToken(
          req.params.token,
          Date.now(),
          hash
        );

        if (numReplaced === 0) {
          logger.error('No user updated during password reset');
          req.flash('error', 'Error updating password. Please try again.');
          return res.redirect('/reset/' + req.params.token);
        }

        logger.info('Password successfully updated for user:', user.email);
        req.flash(
          'success',
          'Password updated successfully. Please login with your new password.'
        );
        res.redirect('/login');
      } catch (err) {
        logger.error('Password reset error', { error: err.message });
        req.flash('error', 'Error processing password. Please try again.');
        res.redirect('/reset/' + req.params.token);
      }
    }
  );
};
