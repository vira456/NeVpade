// Документи в режимі моків: файли зберігаються в IndexedDB браузера (localStorage для фото замалий)
import { ApiError } from '../api/client.js';
import { EXPIRING_DAYS } from '../api/documents.js';

const DB_NAME = 'nevpade-docs';
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('docs', { keyPath: 'id' });
      store.createIndex('owner', 'owner');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new ApiError('Браузер не дозволяє зберігати файли (приватний режим?)', 0));
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const store = (await db()).transaction('docs', mode).objectStore('docs');
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new ApiError('Не вдалося зберегти файл у браузері', 0));
  });
}

// Посилання на файл у пам'яті браузера; одне на документ, щоб не плодити копії
const urls = new Map();
const toDto = ({ blob, owner, ...doc }) => {
  if (!urls.has(doc.id)) urls.set(doc.id, URL.createObjectURL(blob));
  return { ...doc, url: urls.get(doc.id) };
};

const byOwner = (owner) => tx('readonly', (s) => s.index('owner').getAll(owner));

/** Видалити всі документи машини, водія чи рейсу (разом з ними самими) */
export async function deleteOwnerDocs(ownerType, ownerId) {
  const docs = await byOwner(`${ownerType}:${ownerId}`);
  await Promise.all(docs.map((d) => tx('readwrite', (s) => s.delete(d.id))));
}

export const list = async (ownerType, ownerId) =>
  (await byOwner(`${ownerType}:${ownerId}`)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toDto);

export async function upload(ownerType, ownerId, { file, type, validUntil, name }) {
  const doc = {
    id: `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    owner: `${ownerType}:${ownerId}`,
    type,
    validUntil,
    name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  };
  await tx('readwrite', (s) => s.put(doc));
  return toDto(doc);
}

export async function remove(docId) {
  await tx('readwrite', (s) => s.delete(docId));
  if (urls.has(docId)) URL.revokeObjectURL(urls.get(docId));
  urls.delete(docId);
  return null;
}

export async function summary(ownerType) {
  const all = await tx('readonly', (s) => s.getAll());
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + EXPIRING_DAYS * 864e5).toISOString().slice(0, 10);
  const out = {};
  for (const d of all) {
    const [type, id] = d.owner.split(':');
    if (type !== ownerType) continue;
    out[id] ??= { count: 0, expiring: 0, expired: 0 };
    out[id].count++;
    if (d.validUntil && d.validUntil < today) out[id].expired++;
    else if (d.validUntil && d.validUntil <= soon) out[id].expiring++;
  }
  return out;
}
