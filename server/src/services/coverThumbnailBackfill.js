import { existsSync } from 'node:fs';
import {
  ensureBookCoverThumbnails,
  saveBookCoverAssets,
} from './coverStorage.js';
import { parseEpubDetails } from './epubService.js';
import { toAbsoluteStoragePath } from './fileStorage.js';

const DEFAULT_START_DELAY_MS = 1500;
const DEFAULT_BETWEEN_BOOK_DELAY_MS = 100;

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function storedFileExists(storedPath) {
  if (!storedPath) return false;

  try {
    return existsSync(toAbsoluteStoragePath(storedPath));
  } catch {
    return false;
  }
}

function thumbnailsAreReady(book) {
  return (
    storedFileExists(book.cover_thumbnail_small_path) &&
    storedFileExists(book.cover_thumbnail_large_path)
  );
}

async function buildCoverAssets(book) {
  const bookFilePath = toAbsoluteStoragePath(book.file_path);

  if (storedFileExists(book.cover_path)) {
    const thumbnails = await ensureBookCoverThumbnails({
      bookFilePath,
      storedCoverPath: book.cover_path,
    });

    return {
      coverPath: book.cover_path,
      ...thumbnails,
    };
  }

  const epubDetails = await parseEpubDetails(bookFilePath);
  return saveBookCoverAssets({
    bookFilePath,
    coverImage: epubDetails.coverImage,
    title: epubDetails.metadata.title || book.title,
    author: epubDetails.metadata.author || book.author,
  });
}

export async function backfillCoverThumbnails(db, options = {}) {
  const shouldStop = options.shouldStop || (() => false);
  const betweenBookDelayMs =
    options.betweenBookDelayMs ?? DEFAULT_BETWEEN_BOOK_DELAY_MS;
  const books = db.prepare(`
    SELECT *
    FROM books
    ORDER BY
      CASE WHEN folder_id IS NULL THEN 0 ELSE 1 END,
      sort_order ASC,
      id ASC
  `).all();
  const updateCoverAssets = db.prepare(`
    UPDATE books
    SET cover_path = @coverPath,
        cover_thumbnail_small_path = @coverThumbnailSmallPath,
        cover_thumbnail_large_path = @coverThumbnailLargePath,
        cover_thumbnail_version = @coverThumbnailVersion
    WHERE id = @id
      AND file_path = @filePath
  `);
  let convertedCount = 0;
  let failedCount = 0;

  for (const book of books) {
    if (shouldStop()) break;
    if (thumbnailsAreReady(book)) continue;

    try {
      const assets = await buildCoverAssets(book);
      updateCoverAssets.run({
        id: book.id,
        filePath: book.file_path,
        ...assets,
      });
      convertedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(
        `Failed to backfill cover thumbnails for book ${book.id} [${error.code || 'UNEXPECTED_ERROR'}]`,
      );
    }

    if (!shouldStop() && betweenBookDelayMs > 0) {
      await delay(betweenBookDelayMs);
    }
  }

  return {
    convertedCount,
    failedCount,
    stopped: shouldStop(),
  };
}

export function startCoverThumbnailBackfill(db, options = {}) {
  let stopped = false;
  const startDelayMs = options.startDelayMs ?? DEFAULT_START_DELAY_MS;
  const done = (async () => {
    if (startDelayMs > 0) {
      await delay(startDelayMs);
    }

    if (stopped) {
      return {
        convertedCount: 0,
        failedCount: 0,
        stopped: true,
      };
    }

    const result = await backfillCoverThumbnails(db, {
      ...options,
      shouldStop: () => stopped,
    });

    if (result.convertedCount || result.failedCount) {
      console.log(
        `Cover thumbnail backfill finished: ${result.convertedCount} converted, ${result.failedCount} failed`,
      );
    }

    return result;
  })().catch((error) => {
    console.error('Cover thumbnail backfill failed:', error);
    return {
      convertedCount: 0,
      failedCount: 1,
      stopped,
    };
  });

  return {
    done,
    async close() {
      stopped = true;
      await done;
    },
  };
}
