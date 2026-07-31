import { Router } from 'express';
import {
  formatProgress,
  getExactProgress,
  getLatestEquivalentProgress,
  listRecentReadingEntries,
} from '../services/readingLibrary.js';

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

function parseBookId(value) {
  const bookId = Number(value);

  if (!Number.isInteger(bookId) || bookId <= 0) {
    const error = new Error('book id must be a positive integer');
    error.status = 400;
    throw error;
  }

  return bookId;
}

// GET /api/reading/recent
router.get('/recent', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    res.json({
      items: listRecentReadingEntries(db),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reading/:bookId
router.get('/:bookId', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.bookId);
    const row = getLatestEquivalentProgress(db, bookId);
    const progress = formatProgress(row);

    res.json({
      progress: progress ? { ...progress, bookId } : null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/reading/:bookId
router.put('/:bookId', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.bookId);
    const { cfi, progress, chapterHref, chapterLabel } = req.body;

    const progressValue = Number(progress);

    if (!Number.isFinite(progressValue) || progressValue < 0 || progressValue > 1) {
      const error = new Error('progress must be a number between 0 and 1');
      error.status = 400;
      throw error;
    }

    const bookExists = db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId);
    if (!bookExists) {
      const error = new Error('Book not found');
      error.status = 404;
      error.code = 'BOOK_NOT_FOUND';
      throw error;
    }

    db.prepare(`
      INSERT INTO reading_progress (book_id, cfi, progress, chapter_href, chapter_label, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(book_id) DO UPDATE SET
        cfi = excluded.cfi,
        progress = excluded.progress,
        chapter_href = excluded.chapter_href,
        chapter_label = excluded.chapter_label,
        updated_at = excluded.updated_at
    `).run(bookId, cfi ?? null, progressValue, chapterHref ?? null, chapterLabel ?? null);

    const row = getExactProgress(db, bookId);

    res.json({ progress: formatProgress(row) });
  } catch (err) {
    next(err);
  }
});

export default router;
