/**
 * IndexedDB wrapper for storing and retrieving raw asset file buffers.
 */

const DB_NAME = 'AtomicBomberperson';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const META_STORE = 'metadata';

export interface AssetMetadata {
  importedAt: number;   // timestamp ms
  fileCount: number;
  totalSize: number;    // bytes
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/** Store a single raw file buffer keyed by its path inside the zip. */
export async function storeFile(
  filename: string,
  data: ArrayBuffer,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, FILES_STORE, 'readwrite').put(data, filename);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Retrieve a single raw file buffer by filename. */
export async function getFile(
  filename: string,
): Promise<ArrayBuffer | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, FILES_STORE, 'readonly').get(filename);
    req.onsuccess = () => { db.close(); resolve(req.result as ArrayBuffer | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Return all stored filenames. */
export async function getAllFileNames(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, FILES_STORE, 'readonly').getAllKeys();
    req.onsuccess = () => { db.close(); resolve(req.result as string[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Store import metadata. */
export async function storeMetadata(meta: AssetMetadata): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, META_STORE, 'readwrite').put(meta, 'import');
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Retrieve import metadata, or null if nothing cached. */
export async function getMetadata(): Promise<AssetMetadata | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, META_STORE, 'readonly').get('import');
    req.onsuccess = () => { db.close(); resolve((req.result as AssetMetadata) ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Check whether cached assets exist. */
export async function hasAssets(): Promise<boolean> {
  const meta = await getMetadata();
  return meta !== null && meta.fileCount > 0;
}

/** Clear all cached assets and metadata. */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([FILES_STORE, META_STORE], 'readwrite');
    t.objectStore(FILES_STORE).clear();
    t.objectStore(META_STORE).clear();
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
