module.exports = {
  async up(client) {
    await client.query(`CREATE INDEX idx_artist_service_aliases_source_album_id
      ON public.artist_service_aliases (source_album_id)`);
  },
  async down(client) {
    await client.query(
      'DROP INDEX public.idx_artist_service_aliases_source_album_id'
    );
  },
};
