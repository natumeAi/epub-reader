import { formatBook } from './bookLibrary.js';

function normalizeBookIdentityValue(value) {
  return String(value ?? '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function bookContentKey(book) {
  const fileSize = Number(book?.file_size);
  const identifier = normalizeBookIdentityValue(book?.identifier);
  const hasUsefulIdentifier =
    identifier && !['none', 'unknown', 'n/a'].includes(identifier);

  if (hasUsefulIdentifier) {
    return `identifier:${identifier}:${fileSize}`;
  }

  return `file:${normalizeBookIdentityValue(book?.file_name)}:${fileSize}`;
}

export function getExactProgress(db, bookId) {
  return db
    .prepare('SELECT * FROM reading_progress WHERE book_id = ?')
    .get(bookId) ?? null;
}

export function getLatestEquivalentProgress(db, bookId) {
  const targetBook = db
    .prepare('SELECT id, identifier, file_name, file_size FROM books WHERE id = ?')
    .get(bookId);
  if (!targetBook) return null;

  const targetContentKey = bookContentKey(targetBook);
  const candidates = db
    .prepare(
      `SELECT rp.*, b.identifier, b.file_name, b.file_size
       FROM reading_progress rp
       INNER JOIN books b ON b.id = rp.book_id
       WHERE b.file_size = ?
       ORDER BY rp.updated_at DESC, rp.book_id DESC`,
    )
    .all(targetBook.file_size);

  return candidates.find((row) => bookContentKey(row) === targetContentKey) ?? null;
}

export function formatProgress(row) {
  if (!row) return null;

  return {
    bookId: row.book_id,
    cfi: row.cfi,
    progress: row.progress,
    chapterHref: row.chapter_href,
    chapterLabel: row.chapter_label,
    updatedAt: row.updated_at,
  };
}

export function listRecentReadingEntries(db, options = {}) {
  const limit = options.limit ?? 10;
  const rows = db
    .prepare(
      `SELECT b.*,
              rp.book_id AS progress_book_id,
              rp.cfi AS progress_cfi,
              rp.progress AS progress_value,
              rp.chapter_href AS progress_chapter_href,
              rp.chapter_label AS progress_chapter_label,
              rp.updated_at AS progress_updated_at
       FROM reading_progress rp
       INNER JOIN books b ON b.id = rp.book_id
       ORDER BY rp.updated_at DESC, rp.book_id DESC`,
    )
    .all();
  const seenContentKeys = new Set();
  const entries = [];

  for (const row of rows) {
    const contentKey = bookContentKey(row);
    if (seenContentKeys.has(contentKey)) continue;
    seenContentKeys.add(contentKey);
    entries.push({
      book: formatBook(row),
      progress: formatProgress({
        book_id: row.progress_book_id,
        cfi: row.progress_cfi,
        progress: row.progress_value,
        chapter_href: row.progress_chapter_href,
        chapter_label: row.progress_chapter_label,
        updated_at: row.progress_updated_at,
      }),
    });
    if (entries.length === limit) break;
  }

  return entries;
}
