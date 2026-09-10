function serializeIdentity(user) {
  return { id: user._id, version: String(user.authVersion || 0) };
}

async function resolveSessionIdentity(identity, authService) {
  const id = typeof identity === 'string' ? identity : identity?.id;
  if (!id) return null;
  const user = await authService.getUserById(id);
  if (
    !user ||
    (user.approvalStatus != null && user.approvalStatus !== 'approved')
  )
    return null;
  const version = typeof identity === 'string' ? '0' : String(identity.version);
  return version === String(user.authVersion || 0) ? user : null;
}

module.exports = { serializeIdentity, resolveSessionIdentity };
