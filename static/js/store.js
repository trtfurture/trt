/* PEA Studio local-first storage. Project files never leave this browser unless exported. */
(function () {
  'use strict';
  const DB_NAME = 'pea-studio-local';
  const DB_VERSION = 1;
  let dbPromise;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support local project storage. Please use a current version of Chrome or Edge.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local project storage.'));
      request.onblocked = () => reject(new Error('Close other PEA Studio tabs and reload this one.'));
    });
    return dbPromise;
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
    });
  }

  async function storeAction(storeName, mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result && typeof result.then === 'function' ? result : result);
      tx.onerror = () => reject(tx.error || new Error('Could not save local data.'));
      tx.onabort = () => reject(tx.error || new Error('Local storage transaction was interrupted.'));
    });
  }

  window.PeaStore = {
    async put(storeName, value) { return storeAction(storeName, 'readwrite', store => store.put(value)); },
    async get(storeName, key) { return requestPromise((await openDB()).transaction(storeName).objectStore(storeName).get(key)); },
    async all(storeName) { return requestPromise((await openDB()).transaction(storeName).objectStore(storeName).getAll()); },
    async remove(storeName, key) { return storeAction(storeName, 'readwrite', store => store.delete(key)); },
    async clear(storeName) { return storeAction(storeName, 'readwrite', store => store.clear()); },
    async estimate() {
      try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; }
      catch (_) { return null; }
    },
    async persist() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
      catch (_) { return false; }
    }
  };
})();
