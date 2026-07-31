import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateLibrarySnapshot } from '../src/utils/librarySnapshot.js';

function snapshotFixture() {
  return {
    schemaVersion: 1,
    version: 7,
    books: [
      {
        id: 1,
        folderId: null,
        title: 'Root book',
        sortOrder: 1000,
      },
      {
        id: 2,
        folderId: 9,
        title: 'Folder book',
        sortOrder: 1000,
      },
    ],
    folders: [
      {
        id: 9,
        name: '技术',
        sortOrder: 2000,
        bookIds: [2],
        previewBookIds: [2],
      },
    ],
    shelf: [
      { type: 'book', id: 1, sortOrder: 1000 },
      { type: 'folder', id: 9, sortOrder: 2000 },
    ],
    recent: [
      {
        bookId: 2,
        progress: {
          bookId: 2,
          progress: 0.5,
        },
      },
    ],
  };
}

test('hydrates normalized snapshot into existing bookshelf view models', () => {
  const hydrated = hydrateLibrarySnapshot(snapshotFixture());

  assert.deepEqual(
    hydrated.shelfData.items.map((item) => item.key),
    ['book:1', 'folder:9'],
  );
  assert.equal(hydrated.shelfData.items[1].folder.previewBooks[0].id, 2);
  assert.equal(hydrated.catalogData.books[1].folderName, '技术');
  assert.equal(hydrated.folderBooksByFolderId.get(9)[0].key, 'folder-book:2');
  assert.equal(hydrated.recentData.items[0].book.id, 2);
});

test('rejects an obsolete snapshot schema so the network can replace it', () => {
  const snapshot = snapshotFixture();
  snapshot.schemaVersion = 99;

  assert.throws(
    () => hydrateLibrarySnapshot(snapshot),
    /not supported/,
  );
});
