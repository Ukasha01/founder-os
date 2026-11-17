import type { QueueStore, QueuedCapture } from "./queue";

// IndexedDB-backed queue. Database and store names are shared with public/offline.html.
const DB = "founder-os-offline", STORE = "capture_queue";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  }));
}
export const idbStore: QueueStore = {
  list: () => run("readonly", (s) => s.getAll() as IDBRequest<QueuedCapture[]>),
  put: async (item) => { await run("readwrite", (s) => s.put(item)); },
  remove: async (id) => { await run("readwrite", (s) => s.delete(id)); },
};
