/* SlimStore — тонкая обёртка над IndexedDB для SlimTrack */
(function () {
  'use strict';
  var DB_NAME = 'slimtrack';
  var DB_VER = 1;
  var STORE = 'state';
  var KEY = 'app';

  var dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) return reject(new Error('NO_IDB'));
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IDB_OPEN')); };
    });
    return dbPromise;
  }

  function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function get(defaultValue) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = tx(db, 'readonly').get(KEY);
        req.onsuccess = function () { resolve(req.result != null ? req.result : defaultValue); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function set(value) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = tx(db, 'readwrite').put(value, KEY);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clear() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = tx(db, 'readwrite').clear();
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  window.SlimStore = { get: get, set: set, clear: clear };
})();