import { formatBook } from './bookLibrary.js';
import { listRecentReadingEntries } from './readingLibrary.js';

export const LIBRARY_SNAPSHOT_SCHEMA_VERSION = 1;

export function getLibraryRevision(db) {
  return db
    .prepare('SELECT revision FROM library_revision WHERE id = 1')
    .get().revision;
}

export function librarySnapshotEtag(revision) {
  return `"library-${revision}"`;
}

function formatSnapshotBook(row) {
  const book = formatBook(row);

  return {
    id: book.id,
    folderId: book.folderId,
    title: book.title,
    author: book.author,
    identifier: book.identifier,
    fileName: book.fileName,
    fileSize: book.fileSize,
    coverPath: book.coverPath,
    coverUrl: book.coverUrl,
    coverThumbnailUrl: book.coverThumbnailUrl,
    coverThumbnail2xUrl: book.coverThumbnail2xUrl,
    coverThumbnailVersion: book.coverThumbnailVersion,
    sortOrder: book.sortOrder,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    readingProgress: row.reading_progress ?? null,
    readingUpdatedAt: row.reading_updated_at ?? null,
  };
}

function compareShelfItems(first, second) {
  if (first.sortOrder !== second.sortOrder) {
    return first.sortOrder - second.sortOrder;
  }
  if (first.type !== second.type) {
    return first.type.localeCompare(second.type);
  }
  return first.id - second.id;
}

export function buildLibrarySnapshot(db) {
  return db.transaction(() => {
    const revision = getLibraryRevision(db);
    const bookRows = db.prepare(`
      SELECT b.*,
             rp.progress AS reading_progress,
             rp.updated_at AS reading_updated_at
      FROM books b
      LEFT JOIN reading_progress rp ON rp.book_id = b.id
      ORDER BY b.id ASC
    `).all();
    const books = bookRows.map(formatSnapshotBook);
    const booksByFolderId = new Map();

    for (const book of books) {
      if (book.folderId == null) continue;
      const folderBooks = booksByFolderId.get(book.folderId) || [];
      folderBooks.push(book);
      booksByFolderId.set(book.folderId, folderBooks);
    }

    for (const folderBooks of booksByFolderId.values()) {
      folderBooks.sort((first, second) =>
        first.sortOrder - second.sortOrder || first.id - second.id);
    }

    const folderRows = db.prepare(`
      SELECT *
      FROM folders
      ORDER BY sort_order ASC, id ASC
    `).all();
    const folders = folderRows.map((row) => {
      const folderBooks = booksByFolderId.get(row.id) || [];
      const bookIds = folderBooks.map((book) => book.id);

      return {
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        bookCount: bookIds.length,
        bookIds,
        previewBookIds: bookIds.slice(0, 4),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    const shelf = [
      ...books
        .filter((book) => book.folderId == null)
        .map((book) => ({
          type: 'book',
          id: book.id,
          sortOrder: book.sortOrder,
        })),
      ...folders.map((folder) => ({
        type: 'folder',
        id: folder.id,
        sortOrder: folder.sortOrder,
      })),
    ].sort(compareShelfItems);
    const recent = listRecentReadingEntries(db).map((entry) => ({
      bookId: entry.book.id,
      progress: entry.progress,
    }));

    return {
      schemaVersion: LIBRARY_SNAPSHOT_SCHEMA_VERSION,
      version: revision,
      books,
      folders,
      shelf,
      recent,
    };
  })();
}
