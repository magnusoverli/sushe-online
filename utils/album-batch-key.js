function albumBatchKey({ album_id, artist, album }) {
  return JSON.stringify([album_id || null, artist, album]);
}

module.exports = { albumBatchKey };
