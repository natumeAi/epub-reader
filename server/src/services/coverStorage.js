import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  coversDir,
  coverThumbnailsDir,
  ensureCoverDirectory,
  toAbsoluteStoragePath,
  toStoredPath,
} from './fileStorage.js';

const fallbackCoverExtension = 'svg';
export const COVER_THUMBNAIL_SMALL_WIDTH = 384;
export const COVER_THUMBNAIL_LARGE_WIDTH = 768;
const thumbnailWidths = [
  COVER_THUMBNAIL_SMALL_WIDTH,
  COVER_THUMBNAIL_LARGE_WIDTH,
];
const mimeTypeExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/svg+xml', 'svg'],
]);

sharp.concurrency(1);
sharp.cache({
  files: 0,
  items: 32,
  memory: 32,
});

function coverBaseName(storedBookPath) {
  return createHash('sha1').update(storedBookPath).digest('hex').slice(0, 24);
}

function coverExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const mapped = mimeTypeExtensions.get(normalized);

  if (mapped) {
    return mapped;
  }

  if (normalized.startsWith('image/')) {
    const extension = normalized.slice('image/'.length).replace(/\+xml$/, '').replace(/[^a-z0-9]/g, '');
    return extension || fallbackCoverExtension;
  }

  return fallbackCoverExtension;
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function trimCoverText(value, fallback, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim() || fallback;

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function fallbackCoverSvg({ title, author }) {
  const displayTitle = escapeXml(trimCoverText(title, 'Untitled Book', 48));
  const displayAuthor = escapeXml(trimCoverText(author, '', 34));
  const authorLine = displayAuthor
    ? `<text x="80" y="1040" font-size="42" font-family="Georgia, serif" fill="#6f6257">${displayAuthor}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1440" viewBox="0 0 960 1440">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f1e7"/>
      <stop offset="0.55" stop-color="#e8dccd"/>
      <stop offset="1" stop-color="#d3c1ad"/>
    </linearGradient>
  </defs>
  <rect width="960" height="1440" rx="36" fill="url(#paper)"/>
  <rect x="56" y="56" width="848" height="1328" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.62" stroke-width="4"/>
  <rect x="76" y="76" width="808" height="1288" rx="24" fill="none" stroke="#9d8772" stroke-opacity="0.28" stroke-width="2"/>
  <text x="80" y="232" font-size="34" font-family="Georgia, serif" fill="#9a7d62" letter-spacing="5">EPUB</text>
  <text x="80" y="690" font-size="72" font-family="Georgia, serif" font-weight="700" fill="#3f342b">${displayTitle}</text>
  ${authorLine}
</svg>
`;
}

function removeStaleCoverVariants(baseName, keepFilePath) {
  for (const fileName of readdirSync(coversDir)) {
    const filePath = path.join(coversDir, fileName);

    if (fileName.startsWith(`${baseName}.`) && path.resolve(filePath) !== path.resolve(keepFilePath)) {
      unlinkSync(filePath);
    }
  }
}

export function saveBookCover({ bookFilePath, coverImage, title, author }) {
  ensureCoverDirectory();

  const storedBookPath = toStoredPath(bookFilePath);
  const baseName = coverBaseName(storedBookPath);
  const extension = coverImage ? coverExtension(coverImage.mimeType) : fallbackCoverExtension;
  const coverPath = path.join(coversDir, `${baseName}.${extension}`);

  if (coverImage) {
    writeFileSync(coverPath, coverImage.data);
  } else {
    writeFileSync(coverPath, fallbackCoverSvg({ title, author }), 'utf8');
  }

  removeStaleCoverVariants(baseName, coverPath);

  return toStoredPath(coverPath);
}

function thumbnailVersion(coverData) {
  return createHash('sha256').update(coverData).digest('hex').slice(0, 20);
}

function thumbnailFilePath(baseName, version, width) {
  return path.join(coverThumbnailsDir, `${baseName}-${version}-${width}.webp`);
}

async function writeThumbnailAtomically(coverData, targetPath, width) {
  if (existsSync(targetPath)) {
    return;
  }

  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;

  try {
    await sharp(coverData, { failOn: 'none' })
      .rotate()
      .resize({
        width,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .webp({
        effort: 4,
        quality: 80,
        smartSubsample: true,
      })
      .toFile(temporaryPath);

    try {
      await rename(temporaryPath, targetPath);
    } catch (error) {
      if (!existsSync(targetPath)) {
        throw error;
      }
    }
  } finally {
    if (existsSync(temporaryPath)) {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}

export async function ensureBookCoverThumbnails({ bookFilePath, storedCoverPath }) {
  ensureCoverDirectory();

  const coverPath = toAbsoluteStoragePath(storedCoverPath);
  const coverData = await readFile(coverPath);
  const storedBookPath = toStoredPath(bookFilePath);
  const baseName = coverBaseName(storedBookPath);
  const version = thumbnailVersion(coverData);
  const storedPaths = new Map();

  for (const width of thumbnailWidths) {
    const targetPath = thumbnailFilePath(baseName, version, width);
    await writeThumbnailAtomically(coverData, targetPath, width);
    storedPaths.set(width, toStoredPath(targetPath));
  }

  return {
    coverThumbnailSmallPath: storedPaths.get(COVER_THUMBNAIL_SMALL_WIDTH),
    coverThumbnailLargePath: storedPaths.get(COVER_THUMBNAIL_LARGE_WIDTH),
    coverThumbnailVersion: version,
  };
}

export async function saveBookCoverAssets(options) {
  const coverPath = saveBookCover(options);
  const thumbnails = await ensureBookCoverThumbnails({
    bookFilePath: options.bookFilePath,
    storedCoverPath: coverPath,
  });

  return {
    coverPath,
    ...thumbnails,
  };
}

export function deleteStoredCover(storedCoverPath) {
  if (!storedCoverPath) {
    return;
  }

  const coverPath = path.resolve(toAbsoluteStoragePath(storedCoverPath));
  const coverRoot = path.resolve(coversDir);

  if (!coverPath.startsWith(`${coverRoot}${path.sep}`) || !existsSync(coverPath)) {
    return;
  }

  unlinkSync(coverPath);
}

export function deleteBookCoverFiles(bookFilePath) {
  ensureCoverDirectory();
  const baseName = coverBaseName(toStoredPath(bookFilePath));

  for (const directory of [coversDir, coverThumbnailsDir]) {
    for (const fileName of readdirSync(directory)) {
      const isSourceCover = directory === coversDir && fileName.startsWith(`${baseName}.`);
      const isThumbnail = directory === coverThumbnailsDir && fileName.startsWith(`${baseName}-`);
      if (!isSourceCover && !isThumbnail) continue;
      const filePath = path.join(directory, fileName);
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  }
}
