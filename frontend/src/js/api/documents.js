// Документи машин, водіїв і рейсів: копії (фото або PDF) техпаспорта, страховки, посвідчення, ТТН, CMR…
// Реальний бекенд: multipart/form-data, файли віддає за посиланням url (див. docs/api-contract.md).
// Відповіді в режимі моків — mock/documents.js (файли в IndexedDB браузера).
import { request } from './client.js';

export const VEHICLE_DOC_TYPES = {
  registration: 'Техпаспорт',
  insurance: 'Страховий поліс',
  inspection: 'Техогляд',
  license: 'Ліцензія / дозвіл',
  lease: 'Договір оренди',
  other: 'Інше',
};

export const DRIVER_DOC_TYPES = {
  license: 'Посвідчення водія',
  passport: 'Паспорт',
  tax_id: 'ІПН',
  medical: 'Медична довідка',
  tachograph: 'Картка водія (тахограф)',
  other: 'Інше',
};

export const TRIP_DOC_TYPES = {
  ttn: 'ТТН',
  cmr: 'CMR',
  act: 'Акт виконаних робіт',
  invoice: 'Рахунок',
  request: 'Заявка на перевезення',
  loading_photo: 'Фото завантаження',
  unloading_photo: 'Фото розвантаження',
  other: 'Інше',
};

export const MAX_FILE_MB = 10;
export const EXPIRING_DAYS = 30;

// ---------- API ----------
/** Список документів машини (ownerType = 'vehicles'), водія ('drivers') чи рейсу ('trips') */
export const getDocuments = (ownerType, ownerId) => request(`/${ownerType}/${ownerId}/documents`, { mock: (m) => m.documents.list(ownerType, ownerId) });

/** Завантажити копію: file — фото (уже стиснуте) або PDF; type — ключ із *_DOC_TYPES */
export function uploadDocument(ownerType, ownerId, { file, type, validUntil = null, name = file.name }) {
  const form = new FormData();
  form.append('file', file, name);
  form.append('type', type);
  if (validUntil) form.append('validUntil', validUntil);
  return request(`/${ownerType}/${ownerId}/documents`, {
    method: 'POST',
    body: form,
    mock: (m) => m.documents.upload(ownerType, ownerId, { file, type, validUntil, name }),
  });
}

export const deleteDocument = (ownerType, ownerId, docId) =>
  request(`/${ownerType}/${ownerId}/documents/${docId}`, { method: 'DELETE', mock: (m) => m.documents.remove(docId) });

/** Короткий підсумок для списку: { [id]: { count, expiring, expired } } */
export const getDocumentsSummary = (ownerType) => request(`/${ownerType}/documents/summary`, { mock: (m) => m.documents.summary(ownerType) });
