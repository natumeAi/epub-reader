import { ShelfItemCover } from './ShelfItemCover.jsx';

export function ReadOnlyShelfItem({ item, onOpenBook, onOpenFolder, priority = false }) {
  const name = item.type === 'folder'
    ? item.folder?.name || '文件夹'
    : item.book?.title || '未命名书籍';
  const label = item.type === 'book' && item.folderName
    ? `${name}，位于“${item.folderName}”`
    : name;

  const handleClick = (event) => {
    if (item.type === 'folder') {
      const rect = event.currentTarget.querySelector('.folder-cover')?.getBoundingClientRect();
      onOpenFolder(item.folder, rect || null);
      return;
    }

    const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
    onOpenBook(item.book, rect || null);
  };

  return (
    <button
      className="book-shell shelf-item read-only-shelf-item"
      type="button"
      aria-label={label}
      data-readonly="true"
      data-book-id={item.type === 'book' ? item.book?.id : undefined}
      data-folder-id={item.type === 'folder' ? item.folder?.id : undefined}
      onClick={handleClick}
    >
      <ShelfItemCover item={item} priority={priority} />
      <span className="shelf-item-label">{name}</span>
      {item.type === 'book' && item.folderName ? (
        <span className="shelf-item-context">位于“{item.folderName}”</span>
      ) : null}
    </button>
  );
}
