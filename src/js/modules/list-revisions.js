const revisions = new Map();
export function rememberListRevision(id, revision) {
  if (id && revision !== undefined && revision !== null)
    revisions.set(id, String(revision));
}
export function getListRevision(id) {
  return revisions.get(id);
}
