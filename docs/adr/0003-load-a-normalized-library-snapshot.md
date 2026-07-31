# Load a normalized library snapshot

Bookshelf structure, the complete Catalog, Folder membership, and recent-reading references will load through one compressed, versioned, normalized library snapshot in which each Book is represented once and relationships use IDs. This replaces three duplicative startup reads so the PWA can cache one coherent state and open any Folder without another request; the existing read endpoints remain temporarily available for rollback compatibility.
