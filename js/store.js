// Large lesson files (background images, narration) live in IndexedDB, which has far more
// room than localStorage. The lesson itself stays in localStorage without them.
const DB = 'manimvis', STORE = 'assets';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

const saved = new Set();
// Store any assets not saved yet. Returns false when the browser refused (out of space).
export async function saveAssets(assets) {
  const todo = Object.entries(assets || {}).filter(([id]) => !saved.has(id));
  if (!todo.length) return true;
  try {
    await tx('readwrite', (s) => todo.forEach(([id, a]) => s.put(a, id)));
    todo.forEach(([id]) => saved.add(id));
    return true;
  } catch { return false; }
}

// Every stored asset, as {id: asset}.
export async function loadAssets() {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const out = {};
      const req = d.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out[c.key] = c.value; saved.add(c.key); c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return {}; }
}

// Forget stored assets the lesson no longer uses.
export async function pruneAssets(keep) {
  try {
    const all = await loadAssets();
    const drop = Object.keys(all).filter((id) => !keep.has(id));
    if (drop.length) await tx('readwrite', (s) => drop.forEach((id) => s.delete(id)));
    drop.forEach((id) => saved.delete(id));
  } catch {}
}
