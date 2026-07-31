import { createApp } from './app.js';
import { createDatabase } from './db/database.js';
import { startBookDirectoryWatcher } from './services/bookDirectoryWatcher.js';
import { startCoverThumbnailBackfill } from './services/coverThumbnailBackfill.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const db = createDatabase();
const bookDirectoryWatcher = startBookDirectoryWatcher(db);
const coverThumbnailBackfill = startCoverThumbnailBackfill(db);
const app = createApp({ db });

const server = app.listen(port, host, () => {
  console.log(`EPUB reader server listening on http://${host}:${port}`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down server`);
  await Promise.all([
    bookDirectoryWatcher.close(),
    coverThumbnailBackfill.close(),
  ]);

  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
