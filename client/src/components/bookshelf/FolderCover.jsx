import {
  getBookCoverImage,
  recoverLegacyCover,
  revealCoverImage,
} from './BookCover.jsx';

export function FolderCover({ folder }) {
  const previewBooks = (folder.previewBooks || []).slice(0, 4);

  return (
    <span className="folder-cover">
      <span className="folder-preview-grid" aria-hidden="true">
        {previewBooks.map((previewBook, index) => {
          const image = getBookCoverImage(previewBook);

          return (
            <span className="folder-preview-slot" key={previewBook.id ?? index}>
              {image.src ? (
                <img
                  className="folder-preview-image"
                  src={image.src}
                  srcSet={image.srcSet}
                  sizes="64px"
                  alt=""
                  width="384"
                  height="576"
                  decoding="async"
                  fetchPriority="low"
                  loading="lazy"
                  data-fallback-url={image.fallbackUrl || undefined}
                  onError={recoverLegacyCover}
                  onLoad={revealCoverImage}
                />
              ) : (
                <span className="folder-preview-image folder-preview-image-empty" />
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}
