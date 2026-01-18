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
    users,
    logger,
    crypto,
    bcrypt,
    nodemailer,
    csrfProtection,
    forgotPasswordRateLimit,
    resetPasswordRateLimit,
    htmlTemplate,
    forgotPasswordTemplate,
    invalidTokenTemplate,
    resetPasswordTemplate,
    composeForgotPasswordEmail,
  } = deps;

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
  app.post('/forgot', forgotPasswordRateLimit, csrfProtection, (req, res) => {
    const { email } = req.body;

    if (!email) {
      req.flash('error', 'Please provide an email address');
      return res.redirect('/forgot');
    }

    users.findOne({ email }, (err, user) => {
      if (err) {
        logger.error('Database error during forgot password', {
          error: err.message,
        });
        req.flash('error', 'An error occurred. Please try again.');
        return res.redirect('/forgot');
      }

      // Always show the same message for security reasons
      req.flash('info', 'If that email exists, you will receive a reset link');

      if (!user) {
        // Don't reveal that the email doesn't exist
        return res.redirect('/forgot');
      }

      const token = crypto.randomBytes(20).toString('hex');
      const expires = Date.now() + 3600000; // 1 hour

      users.update(
        { _id: user._id },
        { $set: { resetToken: token, resetExpires: expires } },
        {},
        (err, numReplaced) => {
          if (err) {
            logger.error('Failed to set reset token', { error: err.message });
            // Don't show error to user for security reasons
            return res.redirect('/forgot');
          }

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
                pass:
                  process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY,
              },
            });

            logger.info(`Email service configured: ${serviceName}`);

            const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
            const emailOptions = composeForgotPasswordEmail(
              user.email,
              resetUrl
            );

            transporter.sendMail(emailOptions, (error, _info) => {
              if (error) {
                logger.error(
                  `Failed to send password reset email via ${serviceName}:`,
                  error.message
                );
              } else {
                logger.info(
                  `Password reset email sent successfully via ${serviceName}`,
                  {
                    email: user.email,
                  }
                );
              }
            });
          } else {
            logger.warn(
              'No email service configured (RESEND_API_KEY or SENDGRID_API_KEY required) - password reset email not sent'
            );
            logger.debug('Reset token for testing', { token });
          }

          res.redirect('/forgot');
        }
      );
    });
  });

  // Reset password page
  app.get('/reset/:token', csrfProtection, (req, res) => {
    users.findOne(
      { resetToken: req.params.token, resetExpires: { $gt: Date.now() } },
      (err, user) => {
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
      }
    );
  });

  // Handle password reset
  app.post(
    '/reset/:token',
    resetPasswordRateLimit,
    csrfProtection,
    async (req, res) => {
      users.findOne(
        { resetToken: req.params.token, resetExpires: { $gt: Date.now() } },
        async (err, user) => {
          if (err) {
            logger.error('Error finding user with reset token', {
              error: err.message,
            });
            return res.send(
              htmlTemplate(
                invalidTokenTemplate(),
                'Invalid Token - Black Metal Auth'
              )
            );
          }

          if (!user) {
            return res.send(
              htmlTemplate(
                invalidTokenTemplate(),
                'Invalid Token - Black Metal Auth'
              )
            );
          }

          try {
            const hash = await bcrypt.hash(req.body.password, 12);

            users.update(
              { _id: user._id },
              {
                $set: { hash },
                $unset: { resetToken: true, resetExpires: true },
              },
              {},
              (err, numReplaced) => {
                if (err) {
                  logger.error('Password reset update error', {
                    error: err.message,
                  });
                  req.flash(
                    'error',
                    'Error updating password. Please try again.'
                  );
                  return res.redirect('/reset/' + req.params.token);
                }

                if (numReplaced === 0) {
                  logger.error('No user updated during password reset');
                  req.flash(
                    'error',
                    'Error updating password. Please try again.'
                  );
                  return res.redirect('/reset/' + req.params.token);
                }

                logger.info(
                  'Password successfully updated for user:',
                  user.email
                );
                req.flash(
                  'success',
                  'Password updated successfully. Please login with your new password.'
                );
                res.redirect('/login');
              }
            );
          } catch (error) {
            logger.error('Password hashing error', { error: error.message });
            req.flash('error', 'Error processing password. Please try again.');
            res.redirect('/reset/' + req.params.token);
          }
        }
      );
    }
  );
};
