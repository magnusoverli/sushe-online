const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encrypt(text, key) {
  if (!key || key.length < 32) {
    throw new Error('Encryption key must be at least 32 characters');
  }

  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText, key) {
  if (!key || key.length < 32) {
    throw new Error('Encryption key must be at least 32 characters');
  }

  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  decrypt,
  encrypt,
};
