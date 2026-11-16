// Копії документів машини, водія або рейсу: завантаження фото/PDF, список, перегляд на весь екран.
import { getDocuments, uploadDocument, deleteDocument, MAX_FILE_MB, EXPIRING_DAYS } from '../api/documents.js';
import { compressImage } from '../utils/image.js';
import { escapeHtml } from '../utils/format.js';
import { icons } from '../utils/icons.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import { showAlert, withLoading } from '../utils/validation.js';
import { t, locale } from '../i18n/index.js';


// Вікно документів і перегляд додаються на сторінку при першому підключенні модуля
// (ними користуються «Автопарк» і «Рейси»)
const MARKUP = `
  <dialog class="modal modal--wide docs" id="docsDialog" aria-labelledby="docsTitle">
    <div class="modal__body">
      <div class="docs__head">
        <div>
          <h2 class="modal__title" id="docsTitle">Документи</h2>
          <p class="docs__owner" id="docsOwner" data-no-i18n></p>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="Закрити">×</button>
      </div>

      <label class="dropzone" id="docsDrop">
        <input type="file" id="docsInput" accept="image/*,application/pdf" multiple class="visually-hidden" />
        <span class="dropzone__icon" aria-hidden="true"></span>
        <span class="dropzone__text"><strong>Додайте фото документів</strong> — перетягніть сюди або натисніть, щоб вибрати. З телефона можна одразу сфотографувати.</span>
        <span class="dropzone__hint">JPG, PNG або PDF, до 10 МБ. Великі фото стискаються автоматично.</span>
      </label>

      <form class="docs__pending" id="docsPendingForm" hidden novalidate>
        <ul class="docs__pending-list" id="docsPending"></ul>
        <div class="docs__pending-actions">
          <button class="btn btn--text" type="button" id="docsPendingClear">Скасувати</button>
          <button class="btn" type="submit" id="docsUpload">Зберегти</button>
        </div>
      </form>

      <p class="auth__alert" role="alert" hidden></p>
      <ul class="docs__grid" id="docsGrid" aria-live="polite"></ul>
    </div>
  </dialog>

  <!-- Перегляд копії на весь екран -->
  <dialog class="viewer" id="viewerDialog" aria-labelledby="viewerCaption">
    <div class="viewer__bar">
      <p class="viewer__caption" id="viewerCaption"></p>
      <a class="icon-btn" id="viewerDownload" download title="Завантажити файл" aria-label="Завантажити файл"></a>
      <button class="icon-btn" type="button" id="viewerDelete" title="Видалити" aria-label="Видалити документ"></button>
      <button class="icon-btn" type="button" data-close title="Закрити" aria-label="Закрити перегляд">×</button>
    </div>
    <div class="viewer__stage" id="viewerStage"></div>
    <button class="viewer__nav viewer__nav--prev" type="button" id="viewerPrev" aria-label="Попередній документ">‹</button>
    <button class="viewer__nav viewer__nav--next" type="button" id="viewerNext" aria-label="Наступний документ">›</button>
  </dialog>
`;
if (!document.getElementById('docsDialog')) document.body.insertAdjacentHTML('beforeend', MARKUP);

const $ = (id) => document.getElementById(id);
const dialog = $('docsDialog');
const input = $('docsInput');
const drop = $('docsDrop');
const pendingForm = $('docsPendingForm');
const pendingList = $('docsPending');
const grid = $('docsGrid');
const viewer = $('viewerDialog');

let ctx = null; // { ownerType, ownerId, types, onChange }
let docs = [];
let pending = []; // { file, preview, type, validUntil, error }
let viewIndex = 0;

const isPdf = (mime) => mime === 'application/pdf';
const date = (iso) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(locale());
const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1048576).toFixed(1)} МБ`);

function validity(validUntil) {
  if (!validUntil) return null;
  const days = Math.ceil((new Date(`${validUntil}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days < 0) return { tone: 'bad', text: t('Прострочено з {date}', { date: date(validUntil) }) };
  if (days <= EXPIRING_DAYS) return { tone: 'warn', text: t('Дійсний до {date} · {n} дн.', { date: date(validUntil), n: days }) };
  return { tone: 'ok', text: t('Дійсний до {date}', { date: date(validUntil) }) };
}

/**
 * Відкрити документи.
 * ownerType: 'vehicles' | 'drivers'; types: { ключ: назва } для вибору типу документа;
 * onChange — викликається після додавання/видалення (щоб оновити лічильники в списку)
 */
export async function openDocuments({ ownerType, ownerId, title, owner, types, onChange = () => {} }) {
  ctx = { ownerType, ownerId, types, onChange };
  $('docsTitle').textContent = title;
  $('docsOwner').textContent = owner;
  clearPending();
  dialog.querySelector('.auth__alert').hidden = true;
  grid.innerHTML = '<li class="docs__empty">Завантажуємо…</li>';
  if (!dialog.open) dialog.showModal();
  try {
    docs = await getDocuments(ownerType, ownerId);
    renderGrid();
  } catch (err) {
    grid.innerHTML = '';
    showAlert(dialog, err.message);
  }
}

// ---------- Збережені документи ----------
function renderGrid() {
  grid.innerHTML = docs.length
    ? docs
        .map((d, i) => {
          const v = validity(d.validUntil);
          return `
      <li class="doc-card">
        <button class="doc-card__thumb" type="button" data-view="${i}" aria-label="${escapeHtml(t('Відкрити: {name}', { name: t(ctx.types[d.type] ?? 'Інше') }))}">
          ${isPdf(d.mime) ? `<span class="doc-card__pdf">PDF</span>` : `<img src="${d.url}" alt="" loading="lazy" />`}
        </button>
        <div class="doc-card__info">
          <p class="doc-card__type">${escapeHtml(ctx.types[d.type] ?? 'Інше')}</p>
          ${v ? `<p class="doc-card__valid is-${v.tone}">${v.text}</p>` : ''}
          <p class="doc-card__meta">${t('Додано {date}', { date: date(d.createdAt) })} · ${sizeText(d.size)}</p>
        </div>
        <button class="icon-btn icon-btn--danger doc-card__delete" type="button" data-delete-doc="${d.id}" title="Видалити" aria-label="${escapeHtml(t('Видалити: {name}', { name: t(ctx.types[d.type] ?? 'Інше') }))}">${icons.trash}</button>
      </li>`;
        })
        .join('')
    : '<li class="docs__empty">Документів ще немає. Додайте фото техпаспорта, страховки чи посвідчення — вони завжди будуть під рукою.</li>';
}

grid.addEventListener('click', async (e) => {
  const view = e.target.closest('[data-view]');
  if (view) return openViewer(Number(view.dataset.view));
  const del = e.target.closest('[data-delete-doc]');
  if (del) removeDoc(docs.find((d) => d.id === del.dataset.deleteDoc));
});

async function removeDoc(doc) {
  const name = t(ctx.types[doc.type] ?? 'Інше');
  if (!(await confirmDialog({ title: t('Видалити документ «{name}»?', { name }), text: 'Копію буде видалено назавжди.' }))) return false;
  try {
    await deleteDocument(ctx.ownerType, ctx.ownerId, doc.id);
    docs = docs.filter((d) => d.id !== doc.id);
    renderGrid();
    ctx.onChange();
    showToast(t('Документ «{name}» видалено', { name }));
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

// ---------- Вибір і завантаження нових ----------
function clearPending() {
  pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
  pending = [];
  pendingForm.hidden = true;
  pendingList.innerHTML = '';
  input.value = '';
}

function addFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const okType = file.type.startsWith('image/') || isPdf(file.type);
    const error = !okType
      ? 'Можна додати лише фото або PDF'
      : file.size > MAX_FILE_MB * 1024 * 1024 && isPdf(file.type)
        ? t('PDF завеликий: максимум {n} МБ', { n: MAX_FILE_MB })
        : '';
    pending.push({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      type: '',
      validUntil: '',
      error,
    });
  }
  renderPending();
}

function renderPending() {
  pendingForm.hidden = !pending.length;
  const options = Object.entries(ctx.types)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  pendingList.innerHTML = pending
    .map(
      (p, i) => `
    <li class="pending-doc${p.error ? ' is-invalid' : ''}">
      <span class="pending-doc__thumb">${
        p.preview ? `<img src="${p.preview}" alt="" />` : isPdf(p.file.type) ? '<span class="doc-card__pdf">PDF</span>' : icons.doc
      }</span>
      <div class="pending-doc__fields">
        <p class="pending-doc__name" data-no-i18n>${escapeHtml(p.file.name)}</p>
        ${
          p.error
            ? `<p class="field__error">${p.error}</p>`
            : `<label class="visually-hidden" for="pdType${i}">Тип документа</label>
               <select class="input input--compact" id="pdType${i}" data-i="${i}" data-field="type" required>
                 <option value="">Тип документа…</option>${options}
               </select>
               <label class="pending-doc__date">Дійсний до
                 <input class="input input--compact" type="date" data-i="${i}" data-field="validUntil" value="${p.validUntil}" />
               </label>`
        }
      </div>
      <button class="icon-btn" type="button" data-remove="${i}" aria-label="${escapeHtml(t('Прибрати {name}', { name: p.file.name }))}">×</button>
    </li>`
    )
    .join('');
  pendingList.querySelectorAll('[data-field="type"]').forEach((s) => (s.value = pending[s.dataset.i].type));
  const valid = pending.filter((p) => !p.error).length;
  $('docsUpload').textContent = valid > 1 ? t('Зберегти ({n})', { n: valid }) : 'Зберегти';
  $('docsUpload').disabled = !valid;
}

pendingList.addEventListener('change', (e) => {
  const el = e.target.closest('[data-field]');
  if (!el) return;
  pending[el.dataset.i][el.dataset.field] = el.value;
  el.classList.remove('is-invalid');
});

pendingList.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (!rm) return;
  const [p] = pending.splice(Number(rm.dataset.remove), 1);
  if (p.preview) URL.revokeObjectURL(p.preview);
  renderPending();
});

$('docsPendingClear').addEventListener('click', clearPending);

input.addEventListener('change', () => input.files.length && addFiles(input.files));

// Перетягування файлів
['dragenter', 'dragover'].forEach((type) =>
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  })
);
['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

pendingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const items = pending.filter((p) => !p.error);
  const missing = items.findIndex((p) => !p.type);
  if (missing !== -1) {
    const select = pendingList.querySelector(`[data-field="type"][data-i="${pending.indexOf(items[missing])}"]`);
    select.classList.add('is-invalid');
    select.focus();
    return showAlert(dialog, 'Оберіть тип для кожного документа', 'warning');
  }
  dialog.querySelector('.auth__alert').hidden = true;
  try {
    const saved = await withLoading($('docsUpload'), async () => {
      const out = [];
      for (const p of items) {
        const file = p.file.type.startsWith('image/') ? await compressImage(p.file) : p.file;
        const name = file === p.file ? p.file.name : p.file.name.replace(/\.\w+$/, '') + '.jpg';
        out.push(await uploadDocument(ctx.ownerType, ctx.ownerId, { file, type: p.type, validUntil: p.validUntil || null, name }));
      }
      return out;
    });
    docs = [...saved, ...docs];
    clearPending();
    renderGrid();
    ctx.onChange();
    showToast(saved.length === 1 ? 'Документ збережено' : t('Збережено документів: {n}', { n: saved.length }));
  } catch (err) {
    showAlert(dialog, err.message);
  }
});

dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});
dialog.addEventListener('close', clearPending);

// ---------- Перегляд на весь екран ----------
$('viewerDownload').innerHTML = icons.download ?? '↓';
$('viewerDelete').innerHTML = icons.trash;

function openViewer(i) {
  viewIndex = (i + docs.length) % docs.length;
  const d = docs[viewIndex];
  const name = t(ctx.types[d.type] ?? 'Інше');
  const v = validity(d.validUntil);
  $('viewerCaption').textContent = [name, v?.text, docs.length > 1 ? `${viewIndex + 1} / ${docs.length}` : ''].filter(Boolean).join(' · ');
  $('viewerStage').innerHTML = isPdf(d.mime)
    ? `<iframe class="viewer__pdf" src="${d.url}" title="${escapeHtml(name)}"></iframe>`
    : `<img class="viewer__img" src="${d.url}" alt="${escapeHtml(name)}" />`;
  const link = $('viewerDownload');
  link.href = d.url;
  link.download = d.name || `${name}.${isPdf(d.mime) ? 'pdf' : 'jpg'}`;
  $('viewerPrev').hidden = $('viewerNext').hidden = docs.length < 2;
  if (!viewer.open) viewer.showModal();
}

$('viewerPrev').addEventListener('click', () => openViewer(viewIndex - 1));
$('viewerNext').addEventListener('click', () => openViewer(viewIndex + 1));
viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' && docs.length > 1) openViewer(viewIndex - 1);
  if (e.key === 'ArrowRight' && docs.length > 1) openViewer(viewIndex + 1);
});
viewer.addEventListener('click', (e) => {
  if (e.target === viewer || e.target.id === 'viewerStage' || e.target.closest('[data-close]')) viewer.close();
});
viewer.addEventListener('close', () => ($('viewerStage').innerHTML = ''));
$('viewerDelete').addEventListener('click', async () => {
  const doc = docs[viewIndex];
  if (!(await removeDoc(doc))) return;
  if (docs.length) openViewer(Math.min(viewIndex, docs.length - 1));
  else viewer.close();
});
