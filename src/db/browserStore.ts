/** IndexedDB blob store for the browser-dev database file. Android production data lives in native SQLite instead. */
const DB_NAME = 'tawze3-web', STORE = 'kv', KEY = 'sqlite';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}
export async function loadBytes(): Promise<Uint8Array | undefined> {
  const idb = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const r = idb.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result ? new Uint8Array(r.result as ArrayBuffer | Uint8Array) : undefined);
      r.onerror = () => reject(r.error);
    });
  } finally { idb.close(); }
}
export async function saveBytes(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes.slice().buffer, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { idb.close(); }
}
