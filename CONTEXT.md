# EPUB Library

This context describes how readers organize EPUB books and interpret their structure while reading.

## Language

### Library organization

**Bookshelf**:
The compact, ordered top-level collection containing books and folders. Items occupy contiguous positions: dropping in open shelf space resolves to an insertion position rather than creating a persistent empty slot. A Bookshelf containing 300 direct items is the performance acceptance boundary, not a capacity limit.
_Avoid_: Library home, root directory

**Catalog**:
The complete set of imported Books, regardless of whether they appear directly on the Bookshelf or inside a Folder. A Catalog containing 1,000 Books is the performance acceptance boundary, not a capacity limit.
_Avoid_: Bookshelf, root directory

**Folder**:
A named group of books on the Bookshelf. A folder containing 20 books is the performance acceptance boundary, not a capacity limit.
_Avoid_: Directory, collection

**Book**:
An imported EPUB title that can appear directly on the Bookshelf or inside one Folder.
_Avoid_: File, document

### Reading

**Reading Section**:
The continuous content range beginning at one table-of-contents entry and ending at the next distinct table-of-contents entry or the end of the Book. It may span multiple publication documents and includes standalone illustrations within that range.
_Avoid_: Spine item, XHTML file
