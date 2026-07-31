import { Router } from 'express';
import {
  buildLibrarySnapshot,
  getLibraryRevision,
  librarySnapshotEtag,
} from '../services/librarySnapshot.js';

const router = Router();

function requireDatabase(req) {
  const db = req.app.locals.db;

  if (!db) {
    const error = new Error('Database is not configured');
    error.status = 503;
    throw error;
  }

  return db;
}

router.get('/snapshot', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const revision = getLibraryRevision(db);
    const etag = librarySnapshotEtag(revision);

    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('X-Library-Revision', String(revision));

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json({ snapshot: buildLibrarySnapshot(db) });
  } catch (error) {
    next(error);
  }
});

export default router;
