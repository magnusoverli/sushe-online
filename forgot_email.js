// forgot_email.js

const composeForgotPasswordEmail = (userEmail, resetUrl) => {
  // Email content with black metal theme
  const textContent = `A password reset has been requested for your account.

Click here to reset your password: ${resetUrl}

If you did not request this, ignore this email and your password will remain unchanged.

  // HTML version with styling matching the app's theme
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #000000;
      color: #e5e7eb;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #111827;
      border: 1px solid #1f2937;
    }
    .header {
      background-color: #1f2937;
      padding: 30px;
      text-align: center;
      border-bottom: 1px solid #374151;
    }
    .title {
      font-size: 28px;
      color: #dc2626;
      font-weight: bold;
      text-shadow: 0 0 20px rgba(220, 38, 38, 0.5);
      margin: 0;
      letter-spacing: 2px;
    }
    .content {
      padding: 40px 30px;
    }
    .message {
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .button-wrapper {
      text-align: center;
      margin: 30px 0;
    }
    .reset-button {
      display: inline-block;
      background-color: #dc2626;
      color: #ffffff;
      padding: 15px 40px;
      text-decoration: none;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-radius: 4px;
      transition: background-color 0.3s;
    }
    .reset-button:hover {
      background-color: #b91c1c;
    }
    .footer {
      padding: 20px 30px;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
      border-top: 1px solid #1f2937;
    }
    .signature {
      margin-top: 30px;
      font-style: italic;
      color: #9ca3af;
    }
    .url-fallback {
      margin-top: 20px;
      padding: 15px;
      background-color: #1f2937;
      border-radius: 4px;
      word-break: break-all;
      font-family: monospace;
      font-size: 12px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">KVLT</h1>
      <p style="color: #9ca3af; margin: 10px 0 0 0;">Password Reset Request</p>
    </div>
    
    <div class="content">
      <p class="message">
        A password reset has been requested for your account. 
        If you made this request, click the button below to reset your password.
      </p>
      
      <div class="button-wrapper">
        <a href="${resetUrl}" class="reset-button">Reset Password</a>
      </div>
      
      <p style="color: #6b7280; font-size: 14px;">
        If you did not request this password reset, please ignore this email 
        and your password will remain unchanged.
      </p>
      
      <p style="color: #6b7280; font-size: 14px;">
        This link will expire in 1 hour for security reasons.
      </p>
      
      <div class="url-fallback">
        <p style="margin: 0 0 5px 0; color: #9ca3af; font-size: 12px;">
          Or copy and paste this URL into your browser:
        </p>
        <p style="margin: 0; color: #60a5fa;">${resetUrl}</p>
      </div>
      
      <div class="signature">
        <p>Magnus</p>
      </div>
    </div>
    
    <div class="footer">
      <p style="margin: 0;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
  `;

  // Return email configuration object
  return {
    to: userEmail,
    from: process.env.EMAIL_FROM || 'magnus@overli.dev',
    subject: 'SuShe Online - Password Reset',
    text: textContent,
    html: htmlContent
  };
};

module.exports = { composeForgotPasswordEmail };