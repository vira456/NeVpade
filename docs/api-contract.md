# API-контракт NeVpade (чернетка v0.2)

Документ узгоджують фронтенд і бекенд. Мокові дані фронтенду (`frontend/src/js/mock/`) відповідають саме цим структурам, тому зміни в контракті треба вносити в обидва місця.

## Загальні правила

- Базова адреса: `http://localhost:8000/api`
- Формат: JSON, кодування UTF-8
- Назви полів: `camelCase`
- Дати: ISO 8601, `YYYY-MM-DD` (дата) або `YYYY-MM-DDTHH:mm:ssZ` (дата й час)
- Ідентифікатор: поле `id` (рядок). `_id` з MongoDB назовні не віддається
- Гроші: числа в гривнях (`24000`), відстань у км, вага в тоннах
- Авторизація: заголовок `Authorization: Bearer <token>` для всіх запитів, крім `/auth/login`
  - **Обговорити:** зараз фронт тримає токен у `localStorage` — його може прочитати будь-який скрипт на сторінці (XSS). Надійніше, щоб `/auth/login` ставив cookie `HttpOnly; Secure; SameSite=Strict`, а фронт слав запити з `credentials: 'include'` без заголовка `Authorization`. Тоді потрібен CORS з `allow_credentials=True` і точним `origin` фронту (не `*`)
- Ролі: `owner` (керівник компанії) і `manager`. Права перевіряє сервер; фронт лише ховає недоступні кнопки (див. розділ 8, «Ролі»)
- Помилки: `{ "detail": "Текст помилки", "code": "machine_code" }` з відповідним статусом. `detail` показується користувачу, тож пишемо його українською; `code` необов'язковий і потрібен, коли фронт має відреагувати по-особливому

| Код | Значення |
|---|---|
| 200 | OK |
| 201 | Створено |
| 204 | Видалено (без тіла) |
| 400 | Некоректний запит |
| 401 | Не авторизовано / токен прострочений |
| 403 | Доступ заборонено (напр. пошту не підтверджено) |
| 409 | Конфлікт (напр. email уже зареєстровано) |
| 429 | Забагато запитів |
| 404 | Не знайдено |
| 422 | Помилка валідації |

---

## 1. Авторизація

Усі ендпоінти цього розділу публічні (без `Authorization`). Ті, що повертають `token`, видають однакову відповідь:
```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "usr_01", "name": "Олена Коваль", "email": "olena@nevpade.ua",
    "phone": "+380671234567", "phoneVerified": true, "role": "manager",
    "companyId": "cmp_01", "companyName": "ТОВ «Західтранс»"
  }
}
```
Далі це називається **AuthResponse**.

**Порядок реєстрації:** `register` → код на пошту → `verify-email` → SMS на телефон → `verify-phone` → токен.
Телефон завжди у форматі E.164: `+380XXXXXXXXX` (12 цифр після `+`), лише мобільні коди 039, 050, 063, 066, 067, 068, 073, 089, 091–099.

### POST `/auth/register` — реєстрація
```json
{
  "name": "Олена Коваль", "email": "olena@nevpade.ua", "phone": "+380671234567", "password": "secret123",
  "company": { "mode": "create", "name": "ТОВ «Західтранс»" }
}
```
`company` — або `{ "mode": "create", "name": "..." }` (нова компанія, користувач стає її власником `role: "owner"`), або `{ "mode": "join", "code": "NVP-4821" }` (приєднатися до наявної за кодом запрошення).
- 404 `{ "detail": "Компанію з таким кодом не знайдено…", "code": "company_not_found" }`
- Створює користувача з `emailVerified: false`, `phoneVerified: false`, генерує 6-значний код і надсилає його листом
- Токен **не** видається, доки не підтверджено і пошту, і телефон
- Відповідь 201: `{ "email": "olena@nevpade.ua", "message": "Код підтвердження надіслано на пошту" }`
- 409 — email уже зареєстровано
- 409 `{ "detail": "Номер уже використовується", "code": "phone_taken" }`
- 422 — невалідні дані:
  - `name` — рівно два слова (ім'я та прізвище) через пробіл; лише українські/латинські літери, апостроф (`'`, `’`, `ʼ`) і дефіс усередині слова; кожне слово ≥ 2 літер; до 60 символів. Regex для Python: `^[A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]{1,}(?:['’ʼ-][A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]+)* [A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]+(?:['’ʼ-][A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]+)*$` (+ перевірка довжини слів)
  - `phone` — regex `^\+380(39|50|63|66|67|68|73|89|9[1-9])\d{7}$`
  - `password` — мінімум 8 символів, літера й цифра

### POST `/auth/verify-email` — підтвердження коду
```json
{ "email": "olena@nevpade.ua", "code": "123456" }
```
- Позначає `emailVerified: true`, генерує новий код і надсилає його **SMS** на номер користувача
- 200 `{ "next": "verify_phone", "phone": "+380671234567" }` (токен ще не видається)
- 400 `{ "detail": "Невірний код підтвердження", "code": "invalid_code" }`
- 400 `{ "detail": "Термін дії коду минув", "code": "code_expired" }`

### POST `/auth/verify-phone` — підтвердження коду з SMS
```json
{ "email": "olena@nevpade.ua", "code": "123456" }
```
- Позначає `phoneVerified: true`
- 200 → **AuthResponse** (користувач увійшов)
- 400 `invalid_code` / `code_expired` — як у verify-email

### POST `/auth/phone` — вказати або змінити номер до підтвердження
```json
{ "email": "olena@nevpade.ua", "phone": "+380671234567" }
```
Використовується, коли користувач помилився в номері («Змінити номер») або увійшов через Google/Facebook (соцмережі не дають телефон).
- Дозволено лише для користувача з `phoneVerified: false`; якщо в запиті є `Authorization` — брати користувача з токена, а не з `email`
- Зберігає номер і надсилає SMS з кодом
- 200 `{ "phone": "+380671234567", "message": "Код надіслано в SMS" }`
- 409 `phone_taken`, 422 — невалідний номер

### POST `/auth/resend-code` — надіслати код повторно
```json
{ "email": "olena@nevpade.ua", "purpose": "verify" }
```
- `purpose`: `verify` (лист на пошту) | `verify_phone` (SMS) | `reset` (відновлення пароля)
- 200 `{ "message": "Код надіслано повторно" }`
- 429 — якщо запит частіше ніж раз на 60 с (фронт і так блокує кнопку на 60 с)

### POST `/auth/login` — вхід email + пароль
```json
{ "email": "olena@nevpade.ua", "password": "secret123" }
```
- 200 → **AuthResponse**
- 401 `{ "detail": "Невірний email або пароль" }`
- 403 `{ "detail": "Пошту не підтверджено", "code": "email_not_verified" }` — фронт перекидає на сторінку введення коду (бекенду варто заодно надіслати новий код)

### POST `/auth/forgot-password` — запит коду для зміни пароля
```json
{ "email": "olena@nevpade.ua" }
```
- 200 `{ "message": "Якщо такий email зареєстровано, на нього надіслано код" }` — однакова відповідь навіть для неіснуючого email (щоб не розкривати, хто зареєстрований)

### POST `/auth/reset-password` — новий пароль
```json
{ "email": "olena@nevpade.ua", "code": "123456", "password": "newSecret1" }
```
- 200 `{ "message": "Пароль змінено" }`
- 400 `invalid_code` / `code_expired` — як у verify-email

### Вхід і реєстрація через Google / Facebook — загальна схема

Одна кнопка «Продовжити з Google» і для входу, і для реєстрації: що саме відбулось, вирішує бекенд.

```
Кнопка Google ──► POST /auth/google ──┬─ користувач уже є (за googleId або email) ──► AuthResponse ──► /pages/dashboard.html
                                      │
                                      └─ новий ──► створити без компанії, isNew: true ──► /pages/onboarding.html
                                                   «Завершіть реєстрацію»: ім'я, компанія (створити / код), телефон
                                                       │
                                                       ▼
                                            POST /auth/complete-signup ──► SMS ──► /pages/verify-phone.html?mode=social
                                                       │
                                                       ▼
                                            POST /auth/verify-phone ──► /pages/dashboard.html
```

Куди вести користувача, фронт вирішує лише за полями `user` (`nextPageFor` у `frontend/src/js/api/auth.js`):
1. `companyId: null` → `/pages/onboarding.html`
2. `phoneVerified: false` → `/pages/verify-phone.html` (якщо `phone` уже є — одразу поле для коду)
3. інакше → `/pages/dashboard.html`

Те саме перевіряє кожна сторінка застосунку, тож якщо людина закрила вкладку посеред реєстрації, наступного разу вона повернеться на потрібний крок.

### POST `/auth/google` — вхід через Google
```json
{ "credential": "<ID-токен від Google Identity Services>" }
```
- Бекенд перевіряє підпис токена (Python: `google.oauth2.id_token.verify_oauth2_token(credential, requests.Request(), GOOGLE_CLIENT_ID)`): `aud` = наш `GOOGLE_CLIENT_ID`, `iss` = `accounts.google.com`, `email_verified: true`. Бере `sub`, `email`, `name`, `picture`
- Шукає користувача спершу за `googleId` (= `sub`), потім за `email`:
  - знайшов за email (раніше реєструвався паролем) → прив'язує `googleId`, далі звичайний вхід
  - не знайшов → створює: `emailVerified: true` (пошту підтвердив Google), `password: null`, `phone: null`, `phoneVerified: false`, `companyId: null`, `role: null`
- 200 → **AuthResponse** + `"isNew": true` для щойно створеного; 401 — токен недійсний
- Поки `companyId` або `phoneVerified` не заповнено, токен дає доступ лише до `/auth/me`, `/auth/complete-signup`, `/auth/phone`, `/auth/verify-phone`, `/auth/resend-code`; решта → `403 { "code": "signup_incomplete" }`

### POST `/auth/complete-signup` — «Завершіть реєстрацію» (з токеном)
```json
{ "name": "Олена Коваль", "phone": "+380671234567", "company": { "mode": "create", "name": "ТОВ «Нова логістика»" } }
```
`company` — як у `/auth/register`: `create` → нова компанія, роль `owner`; `join` + `code` → роль `manager`.
- Зберігає ім'я (Google може дати псевдонім — користувач його виправив), компанію, роль і телефон, надсилає SMS з кодом
- 200 `{ "user": { ...companyId, companyName, role, phone, "phoneVerified": false }, "message": "Код надіслано в SMS" }`
- 404 `company_not_found`, 409 `phone_taken`, 422 — ті самі правила, що в `/auth/register`
- 409 `already_completed` — у користувача вже є компанія
- Далі фронт відкриває введення коду → `POST /auth/verify-phone` → **AuthResponse** з `phoneVerified: true`

### POST `/auth/facebook` — вхід через Facebook
```json
{ "accessToken": "<токен від Facebook SDK>" }
```
- Бекенд перевіряє токен запитом `GET https://graph.facebook.com/me?fields=id,name,email&access_token=...`
- Далі логіка як у Google (поле `facebookId`, той самий крок `/auth/complete-signup`). Якщо Facebook не віддав email — 400 з поясненням
- 200 → **AuthResponse**

### GET `/auth/me`
Потребує токен. Повертає `user` поточного користувача.

### Вимоги до кодів (для бекенду)
- 6 цифр; код з пошти дійсний 10 хвилин, з SMS — 5 хвилин; після використання видаляється
- Зберігати в БД хеш коду, а не сам код; максимум 5 спроб введення
- Лист надсилати через SMTP (наприклад, Gmail з паролем застосунку) або сервіс на кшталт SendGrid / Brevo
- SMS надсилати через SMS-шлюз з API (наприклад, TurboSMS чи Twilio). Для розробки й захисту можна мати режим, коли код SMS не відправляється, а пишеться в лог сервера

### Спільні ключі
`GOOGLE_CLIENT_ID` і `FACEBOOK_APP_ID` однакові для фронту й бекенду. Фронт тримає їх у `frontend/.env` (`VITE_GOOGLE_CLIENT_ID`), бекенд — у своєму `.env`. Секрет клієнта (`client_secret`) для цієї схеми не потрібен і на фронт не потрапляє.

Як отримати `GOOGLE_CLIENT_ID`:
1. [console.cloud.google.com](https://console.cloud.google.com) → створити проєкт «NeVpade»
2. **APIs & Services → OAuth consent screen**: тип External, назва застосунку, пошта підтримки; scopes лише `email`, `profile`, `openid`; у **Test users** додати пошти, з яких будете входити (поки застосунок у режимі Testing, інші не зможуть)
3. **Credentials → Create credentials → OAuth client ID**, тип **Web application**
4. **Authorized JavaScript origins**: `http://localhost:5173` (і `http://localhost` — Google іноді вимагає обидва), пізніше — адреса сайту на хостингу. **Redirect URIs** не потрібні: кнопка працює через спливаюче вікно й повертає ID-токен у JavaScript
5. Скопіювати Client ID (`…apps.googleusercontent.com`) у `frontend/.env` → `VITE_GOOGLE_CLIENT_ID=…`, `VITE_USE_MOCK=false`, і Ірі в бекенд

---

## 2. Рейси `/trips`

| Метод | URL | Опис |
|---|---|---|
| GET | `/trips?status=planned&search=Львів` | список (фільтри необов'язкові) |
| GET | `/trips/{id}` | один рейс |
| POST | `/trips` | створити |
| PUT | `/trips/{id}` | оновити (усі поля, зокрема `status`, `driverId`, `vehicleId`, `payment`) — свій рейс або будь-який для `owner`, інакше `403 not_owner` |
| PATCH | `/trips/{id}/payment` | лише оплата: `{ "paidAt": "2026-11-20" }` або `{ "paidAt": null }` — зняти позначку |
| DELETE | `/trips/{id}` | видалити (разом із документами рейсу) — ті самі права, що й PUT; відповідь `204` |
| POST | `/trips/{id}/calculate` | розрахунок вартості, пального, ЗП |

Фронт отримує всі рейси компанії одним запитом і сам сортує, фільтрує за датами й оплатою та ділить на сторінки по 20. Коли рейсів стане тисячі — додамо `?page=&limit=&sort=` (формат відповіді тоді `{ "items": [...], "total": 1234 }`).

Об'єкт рейсу:
```json
{
  "id": "trp_001",
  "number": "TR-0042",
  "from": { "city": "Хмельницький", "address": "вул. Проскурівська, 1", "lat": 49.4229, "lng": 26.9871 },
  "to":   { "city": "Львів", "address": "вул. Городоцька, 120", "lat": 49.8397, "lng": 24.0297 },
  "loadDate": "2026-11-15",
  "unloadDate": "2026-11-16",
  "cargo": { "type": "Будматеріали", "weightT": 18, "volumeM3": 60 },
  "vehicleId": "veh_01",
  "driverId": "drv_01",
  "clientId": "cli_01",
  "client": { "name": "ТОВ «БудСервіс»", "phone": "+380671234567" },
  "price": 24000,
  "payment": { "dueDate": "2026-11-30", "paidAt": null },
  "distanceKm": 240,
  "status": "planned",
  "source": "manual",
  "managerId": "usr_01",
  "createdAt": "2026-11-09T10:00:00Z",
  "history": [
    { "at": "2026-11-09T10:00:00Z", "by": "usr_01", "action": "created" },
    { "at": "2026-11-10T08:15:00Z", "by": "usr_01", "action": "updated",
      "changes": [ { "field": "price", "from": 22000, "to": 24000 } ] },
    { "at": "2026-11-15T06:40:00Z", "by": "usr_01", "action": "status", "to": "in_progress" }
  ]
}
```
- `status`: `planned` | `in_progress` | `done` | `cancelled`
- `clientId` — посилання на довідник клієнтів (розділ 2б); `client { name, phone }` — знімок для списку, сервер оновлює його, коли клієнта перейменували. `clientId` може бути `null` (старі рейси, імпорт)
- `payment.dueDate` — коли клієнт має заплатити; якщо фронт не надіслав, сервер ставить `unloadDate` (або `loadDate`) + `paymentDays` клієнта (14, якщо клієнта немає). `payment.paidAt` — дата оплати або `null`
- Стан оплати фронт рахує сам: `paidAt` є → «Оплачено»; рейс `planned`/`cancelled` → не показується; `dueDate` < сьогодні → «Прострочено»; інакше «Очікує оплати»
- `history` веде **лише сервер** (фронт її не надсилає). `action`: `created` | `imported` | `status` (+`to`) | `updated` (+`changes` — лише поля `price`, `loadDate`, `unloadDate`, `driverId`, `vehicleId`, `distanceKm`, `route`) | `paid` | `unpaid` | `transferred` (+`from`, `to` — id менеджерів)
- `source`: `manual` | `import`
- `importedFrom` (для `source: "import"`): `{ "platform": "della", "url": "https://della.ua/…" | null }`, інакше `null`
- `notes`: рядок, необов'язково (тип кузова, завантаження, умови оплати)
- Можуть бути `null` або порожніми: `unloadDate`, `cargo.volumeM3`, `vehicleId`, `driverId`, `client.name`, `client.phone`, а також `lat`/`lng` (у вантажу з Della координат немає — фронт будує маршрут за назвою міста й адресою; бекенд може дописати координати геокодуванням)
- При PUT поля `id` і `createdAt` не надсилаються

### POST `/trips` — новий рейс
Фронт надсилає: `from`, `to` (`city`, `address`), `loadDate`, `unloadDate`, `cargo`, `distanceKm`, `price`, `client`, `driverId`, `vehicleId`, `notes`, `source`, `importedFrom`.
Також `clientId` і `payment` (`dueDate`, `paidAt`). Нового клієнта фронт спершу створює `POST /clients`, потім надсилає його `clientId`.
Сервер сам ставить `id`, `number` (наступний `TR-XXXX`), `status: "planned"`, `managerId` (поточний користувач), `createdAt` і перший запис `history`. Відповідь — створений рейс.
Обов'язкові: `from.city`, `to.city`, `loadDate`, `cargo.type`, `cargo.weightT > 0`, `distanceKm > 0`, `price > 0`; `payment.dueDate` не раніше `loadDate`; інакше `422`.

### Машина й водій рейсу
- POST/PUT з `vehicleId` машини у стані `broken` або `repair` → `409` з `code: "vehicle_unavailable"` (`detail`: «Машина ВХ 1234 АК зламалась — оберіть іншу»)
- Стан машини й водія сервер змінює сам за статусом рейсу:
  - рейс → `in_progress`: машина → `on_trip` (якщо вона не `loading`/`unloaded`), водій → `on_trip`
  - рейс → `done` або `cancelled` (чи видалено рейс у дорозі): машина `loading`/`on_trip`/`unloaded` → `available`, водій → `available` — якщо в них немає іншого рейсу `in_progress`

### Імпорт вантажу з Della (парсинг)
Менеджер вставляє посилання на сторінку пошуку Della (`https://della.ua/search/….html`), фронт завантажує її HTML, розбирає картки вантажів (`frontend/src/js/utils/della.js` → `parseDellaSearchPage`) і показує список. Вибрані вантажі створюються звичайним `POST /trips` з `source: "import"`, `importedFrom: { "platform": "della", "url": "<сторінка пошуку>" }`.

Браузер не може читати della.ua напряму (CORS), тому HTML отримує посередник:
- **розробка** (`npm run dev`): проксі Vite `/della/…` → `https://della.ua/…` (`vite.config.js`), бекенд не потрібен;
- **робоча версія**: бекенд.

| Метод | URL | Опис |
|---|---|---|
| GET | `/import/della?path=/search/a204bd204eflolh0ilk0m1.html` | HTML сторінки пошуку Della |

Відповідь `200`: `{ "html": "<!DOCTYPE html>…" }`
- `path` — лише шляхи, що починаються з `/search/`; інакше `400` (щоб ендпоінт не став відкритим проксі на будь-який сайт)
- бекенд запитує `https://della.ua{path}` (звичайний браузерний `User-Agent`, `Accept-Language: uk`), кешує відповідь на 60 с і не робить більше ~1 запиту на 15 с — не навантажуємо Della
- Della недоступна / відповіла не `200` → `502` з `{ "detail": "Della не відповідає" }`
- приклад на Python: `httpx.get("https://della.ua" + path, headers={...}, timeout=10).text`

Також можна вставити текст одного оголошення вручну або кнопкою-закладкою «→ NeVpade» — тоді розбір іде з тексту (`parseDellaListing`).

---

## 2а. Документи рейсу

ТТН, CMR, акти, рахунки, фото вантажу — ті самі запити, що й для машин і водіїв (розділ 4а) з `{owner}` = `trips`:
`GET/POST /trips/{id}/documents`, `DELETE /trips/{id}/documents/{docId}`, `GET /trips/documents/summary`.

`type`: `ttn` (ТТН) | `cmr` | `act` (акт виконаних робіт) | `invoice` (рахунок) | `request` (заявка на перевезення) | `loading_photo` | `unloading_photo` | `other`.

Заявку на перевезення фронт друкує сам (кнопка «Друк заявки» в картці рейсу → вікно друку / «Зберегти як PDF»), сервер для цього не потрібен.

---

## 2б. Клієнти `/clients`

| Метод | URL | Опис |
|---|---|---|
| GET | `/clients` | усі клієнти компанії |
| POST | `/clients` | додати |
| PUT | `/clients/{id}` | змінити (сервер оновлює знімок `client` у рейсах цього клієнта) |
| DELETE | `/clients/{id}` | видалити (`204`) — лише `owner` (інакше `403 owner_only`) і лише клієнта без рейсів (інакше `409 client_has_trips`) |

```json
{
  "id": "cli_01",
  "name": "ТОВ «БудСервіс»",
  "edrpou": "38214567",
  "contactName": "Олена Ковальчук",
  "phone": "+380671234567",
  "email": "buy@budservis.ua",
  "city": "Хмельницький",
  "paymentDays": 14,
  "notes": "",
  "createdAt": "2024-10-15T09:00:00Z"
}
```
- Обов'язкове лише `name`. `edrpou` — 8 цифр (юрособа) або 10 (ФОП), унікальний у компанії → інакше `409 edrpou_taken`
- `paymentDays` — відстрочка оплати в днях (0–120), з неї рахується `payment.dueDate` нових рейсів
- Борг, виручку й кількість рейсів фронт рахує з `/trips`; окремий ендпоінт не потрібен

---

## 3. Автопарк `/vehicles`

| Метод | URL | Опис |
|---|---|---|
| GET | `/vehicles` | список |
| POST | `/vehicles` | додати машину |
| PUT | `/vehicles/{id}` | змінити дані |
| PATCH | `/vehicles/{id}/status` | змінити лише стан: `{ "status": "loading" }` |
| DELETE | `/vehicles/{id}` | видалити (`204`) |

```json
{
  "id": "veh_01",
  "plate": "ВХ 1234 АК",
  "model": "DAF XF 480",
  "type": "тягач + тент",
  "capacityT": 22,
  "fuelConsumption": 32,
  "mileageKm": 412000,
  "nextServiceKm": 420000,
  "insuranceUntil": "2027-03-01",
  "status": "on_trip",
  "statusUpdatedAt": "2026-11-11T17:40:00Z"
}
```
- DELETE — лише `owner`, інакше `403 owner_only` (так само для водіїв)
- `status` — стан машини: `available` (вільна) | `loading` (на завантаженні) | `on_trip` (в дорозі) | `unloaded` (розвантажилась) | `broken` (зламалась) | `repair` (на ремонті)
- `statusUpdatedAt` — сервер ставить сам при кожній зміні `status`
- `fuelConsumption` — л/100 км; `nextServiceKm` і `insuranceUntil` можуть бути `null`
- `plate` — унікальний у компанії (формат `ВХ 1234 АК`, кирилиця); дубль → `409` з `code: "plate_taken"`
- DELETE: якщо машина в рейсі зі статусом `in_progress` → `409` (`code: "vehicle_busy"`); інакше сервер знімає її із запланованих рейсів (`vehicleId = null`) і з водія

---

## 4. Водії `/drivers`

| Метод | URL | Опис |
|---|---|---|
| GET | `/drivers` | список |
| POST | `/drivers` | додати водія |
| PUT | `/drivers/{id}` | змінити дані (разом із `vehicleId`) |
| PUT | `/drivers/{id}/vehicle` | закріпити машину: `{ "vehicleId": "veh_02" }` або `{ "vehicleId": null }` — відкріпити |
| DELETE | `/drivers/{id}` | видалити (`204`) |

```json
{
  "id": "drv_01",
  "name": "Петро Іваненко",
  "phone": "+380501112233",
  "viber": "+380501112233",
  "licenseCategories": ["C", "CE"],
  "vehicleId": "veh_01",
  "ratePerKm": 10,
  "status": "on_trip"
}
```
- `status`: `available` | `on_trip` | `day_off`
- Одна машина — один водій: коли машину закріплюють за водієм, сервер знімає її з попереднього водія
- `phone`, `viber` — у форматі `+380XXXXXXXXX`; `licenseCategories` — з `B`, `C1`, `C`, `CE`, `D`
- DELETE: водій у рейсі `in_progress` → `409` (`code: "driver_busy"`); із запланованих рейсів сервер його знімає

---

## 4а. Документи машин і водіїв (копії: фото або PDF)

`{owner}` — `vehicles`, `drivers` або `trips` (документи рейсу, розділ 2а).

| Метод | URL | Опис |
|---|---|---|
| GET | `/{owner}/{id}/documents` | список документів (новіші першими) |
| POST | `/{owner}/{id}/documents` | завантажити копію — **multipart/form-data** |
| DELETE | `/{owner}/{id}/documents/{docId}` | видалити (`204`) |
| GET | `/{owner}/documents/summary` | лічильники для списку: `{ "veh_01": { "count": 3, "expiring": 1, "expired": 0 } }` |

POST, поля форми:
- `file` — JPG/PNG/WEBP або PDF, до 10 МБ (фото фронт уже стискає до 2000 px по довшій стороні, ~200–400 КБ)
- `type` — машина: `registration` (техпаспорт), `insurance` (страховий поліс), `inspection` (техогляд), `license` (ліцензія/дозвіл), `lease` (договір оренди), `other`; водій: `license` (посвідчення водія), `passport`, `tax_id` (ІПН), `medical` (медична довідка), `tachograph` (картка водія), `other`
- `validUntil` — `YYYY-MM-DD`, необов'язково

Об'єкт документа:
```json
{
  "id": "doc_01",
  "type": "insurance",
  "validUntil": "2027-03-01",
  "name": "polis.jpg",
  "mime": "image/jpeg",
  "size": 231456,
  "createdAt": "2026-11-11T19:30:00Z",
  "url": "https://.../files/doc_01.jpg?token=..."
}
```
- `url` відкривається в `<img>` / новій вкладці без заголовка `Authorization`, тому це має бути тимчасове підписане посилання (або файли за сесійною cookie). Лише для своєї компанії.
- Неправильний тип файлу → `415`, завеликий → `413`.
- `summary`: `expiring` — документи, у яких `validUntil` протягом 30 днів, `expired` — уже прострочені.
- Коли видаляють машину чи водія, їхні документи теж видаляються.

---

## 5. Завдання (Kanban) `/tasks`

| Метод | URL | Опис |
|---|---|---|
| GET | `/tasks` | усі завдання поточного менеджера |
| POST | `/tasks` | створити |
| PUT | `/tasks/{id}` | оновити (усі поля, крім `id` і `createdAt`) |
| DELETE | `/tasks/{id}` | видалити → 204 |
| PUT | `/tasks/reorder` | зберегти порядок після перетягування |

```json
{
  "id": "tsk_01",
  "title": "Підтвердити завантаження TR-0042",
  "description": "Зателефонувати клієнту",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-11-14",
  "tripId": "trp_001",
  "order": 0,
  "createdAt": "2026-11-08T09:00:00Z"
}
```
- `status`: `todo` («Маю зробити») | `in_progress` («В процесі») | `done` («Зроблено»)
- `priority`: `low` | `medium` | `high`
- `title` — 3–120 символів; `description` — до 1000 символів (може бути `""`)
- `dueDate` — `YYYY-MM-DD` або `null`; при створенні не може бути в минулому
- `tripId` — id рейсу або `null`; якщо рейсу не існує — 422
- `order` — позиція картки в колонці (0 — найвища). Нове завдання фронт створює з `order: 0`, а інші картки колонки зсуває через `/tasks/reorder`

### PUT `/tasks/reorder`
```json
{ "items": [ { "id": "tsk_03", "status": "in_progress", "order": 0 }, { "id": "tsk_01", "status": "in_progress", "order": 1 } ] }
```
У FastAPI маршрут `/tasks/reorder` треба оголосити **перед** `/tasks/{id}`, інакше "reorder" сприйметься як id. Надсилаються лише картки, у яких змінилися `status` або `order`. Бекенд оновлює їх одним запитом (MongoDB `bulk_write`). Відповідь 204. Якщо сервер поверне помилку, фронт поверне картки на попередні місця.

---

## 6. Аналітика `/analytics`

Параметр `period`: `week` | `month` | `year` (поточний тиждень з понеділка / календарний місяць / рік).

Усе рахується **з рейсів** компанії зі статусом `done` або `in_progress` (заплановані й скасовані не входять), за датою `loadDate`. Доходи — `price`, витрати — за формулою з «Розрахунку рейсу» нижче. Так нові, змінені й видалені рейси одразу видно в цифрах. У моках фронт рахує так само (`frontend/src/js/api/analytics.js`).

**Звіт в Excel** (кнопка на сторінці аналітики) фронт формує сам із `/trips`, `/vehicles`, `/drivers`, `/clients`, `/company`, `/company/members` за довільний період (`frontend/src/js/utils/finance-report.js`) — окремий ендпоінт не потрібен. Аркуші: зведення з порівнянням, динаміка, усі рейси з витратами, клієнти, водії, машини.

### GET `/analytics/summary?period=month`
```json
{
  "income": 412000, "expenses": 268000, "profit": 144000, "tripsCount": 18, "distanceKm": 7350,
  "previous": { "income": 418000, "expenses": 271000, "profit": 147000, "tripsCount": 19, "distanceKm": 7620 }
}
```
`previous` — ті самі показники за **такий самий відрізок** попереднього періоду: 1–11 листопада порівнюємо з 1–11 жовтня, а не з цілим жовтнем (інакше на початку місяця завжди «мінус»). Фронт показує зміну у %.

### GET `/analytics/income?period=year`
```json
{
  "labels": ["Січ", "Лют", "Бер"],
  "income":   [310000, 295000, 342000],
  "expenses": [205000, 198000, 221000]
}
```
Підписи: для `week` — дні («Пн»…«Нд»), для `month` — тижні («1–7 лист.»), для `year` — місяці. Майбутні проміжки (ще не настали) — `null`, а не `0`, щоб лінія графіка не падала до нуля.

### GET `/analytics/expenses?period=month`
```json
{ "fuel": 152000, "salary": 78000, "repair": 21000, "tolls": 9000, "other": 8000 }
```

### GET `/analytics/drivers?period=month`
```json
[ { "driverId": "drv_01", "name": "Петро Іваненко", "trips": 6, "income": 138000 } ]
```

### Розрахунок рейсу — POST `/trips/{id}/calculate`
Фронт показує його в картці рейсу. Та сама формула — для аналітики й структури витрат (`frontend/src/js/utils/economics.js`; якщо бекенд змінить числа, треба змінити й там):
- пальне, л = `distanceKm × fuelConsumption / 100` (витрата з автомобіля рейсу, без машини — 32); вартість `fuel` = л × 56 грн/л
- зарплата водія `salary` = `distanceKm × ratePerKm` (ставка з водія рейсу, без водія — 10)
- ремонт і ТО `repair` = `distanceKm × 2.2`
- дороги, стоянки, зважування `tolls` = `distanceKm × 1.1`
- інше `other` = 350 грн на рейс
- відповідь: `otherCosts = repair + tolls + other`, `totalCost`, `profit = price − totalCost`

---

## 7. Профіль менеджера `/profile`

Усі запити з `Authorization`.

### GET `/profile`
```json
{
  "id": "usr_01",
  "fullName": "Федорова Віра Дмитрівна",
  "position": "Старший менеджер з вантажоперевезень",
  "email": "v.fedorova@nevpade.ua",
  "phone": "+380671234567",
  "language": "uk",
  "avatarUrl": "https://.../avatars/usr_01.jpg"
}
```
- `language`: `uk` | `en`
- `avatarUrl`: посилання на фото або `null`
- `position` редагує лише адміністратор (у формі профілю його немає)

### PUT `/profile`
Тіло: `{ "fullName", "email", "phone", "language" }` → оновлений профіль.
- `fullName` — 2–3 слова (прізвище, ім'я, по батькові), ті самі символи, що й при реєстрації, до 80 символів
- 409 `email_taken` / `phone_taken`

### PUT `/profile/avatar`
```json
{ "image": "data:image/jpeg;base64,/9j/4AAQ..." }
```
Фронт сам обрізає фото до квадрата 256×256 і стискає в JPEG (~20–40 КБ). Відповідь — оновлений профіль з `avatarUrl`.

### DELETE `/profile/avatar`
Видаляє фото → профіль з `avatarUrl: null`.

### GET `/profile/kpi`
```json
{ "tripsCount": 66, "tripsThisMonth": 4, "paidOnTime": 87, "activeDrivers": 5 }
```
Рахується з рейсів менеджера (`managerId` = поточний користувач):
- `tripsCount` — виконані (`done`) за весь час; `tripsThisMonth` — виконані з `loadDate` у поточному місяці
- `paidOnTime` — серед виконаних рейсів із `dueDate`: % тих, де `paidAt ≤ dueDate`; `null`, якщо таких рейсів немає
- `activeDrivers` — скільки різних водіїв зараз у рейсах менеджера `planned`/`in_progress`

### POST `/auth/change-password`
```json
{ "currentPassword": "old123abc", "newPassword": "newSecret1" }
```
- 200 `{ "message": "Пароль змінено" }`
- 400 `{ "detail": "Невірний поточний пароль", "code": "invalid_password" }`
- 422 — новий пароль не відповідає вимогам або збігається з поточним

---

## 8. Компанія, команда, чат

Кожен користувач належить рівно одній компанії. **Усі дані (рейси, автопарк, водії, завдання, аналітика) бекенд фільтрує за `companyId` користувача з токена** — менеджери різних компаній не бачать чужого.

### GET `/company`
```json
{ "id": "cmp_01", "name": "ТОВ «Західтранс»", "inviteCode": "NVP-4821", "city": "Хмельницький", "createdAt": "2025-03-12" }
```

### POST `/company/invite` — новий код запрошення
→ `{ "inviteCode": "NVP-7310" }`. Старий код перестає діяти. Формат: три латинські літери, дефіс, чотири цифри.

### GET `/company/members`
```json
[
  { "id": "usr_02", "name": "Мельничук Олег Петрович", "position": "Менеджер з вантажоперевезень",
    "email": "o.melnychuk@nevpade.ua", "phone": "+380672345678", "avatarUrl": null,
    "online": true, "lastSeen": "2026-11-10T08:40:00Z", "role": "manager" }
]
```
`online` — користувач робив запити останні ~2 хвилини (можна оновлювати `lastSeen` у middleware авторизації).

### Ролі
`role`: `owner` (керівник) | `manager`. Хто створив компанію при реєстрації (`company.mode = "create"`) — `owner`, хто приєднався за кодом — `manager`. Роль повертає й `/auth/me` / `/auth/login` у `user.role`.

| Дія | `manager` | `owner` |
|---|---|---|
| Змінити / видалити / передати рейс | лише свій | будь-який |
| Видалити машину, водія, клієнта | `403 owner_only` | ✓ |
| Змінити роль колеги | `403 owner_only` | ✓ |

### PATCH `/company/members/{id}/role`
```json
{ "role": "owner" }
```
- Лише `owner` → інакше `403 owner_only`
- Не можна зняти роль з останнього керівника компанії → `409 last_owner`
- Відповідь — оновлений учасник

### Чат компанії
| Метод | URL | Опис |
|---|---|---|
| GET | `/company/chat?after=<id>` | повідомлення після вказаного (без `after` — останні 100); фронт опитує кожні 4 с |
| POST | `/company/chat` | `{ "text": "..." }` (1–2000 символів) → створене повідомлення |

```json
{ "id": "msg_005", "authorId": "usr_03", "text": "Хтось має вільну машину?", "createdAt": "2026-11-10T08:32:00Z" }
```
Системне повідомлення про передачу рейсу (створює сервер, див. нижче):
```json
{ "id": "msg_007", "type": "transfer", "authorId": "usr_01", "toId": "usr_02", "tripId": "trp_004",
  "text": "Коментар, якщо був", "createdAt": "2026-11-10T09:15:00Z" }
```
Фронт сам рахує непрочитані (пам'ятає id останнього прочитаного). За бажанням пізніше можна замінити опитування на WebSocket.

### POST `/trips/{id}/transfer` — передати рейс колезі
```json
{ "toManagerId": "usr_02", "comment": "Я на лікарняному до кінця тижня" }
```
- У рейсі з'являється поле `managerId` (відповідальний менеджер); `GET /trips` повертає рейси всієї компанії, фронт сам фільтрує «Мої / Уся компанія»
- Передати може поточний `managerId` або `owner` → інакше 403 `not_owner`; `toManagerId` має бути з тієї ж компанії → інакше 422
- Сервер змінює `managerId`, записує `transferredAt` і додає в чат повідомлення `type: "transfer"`
- Відповідь — оновлений рейс

---

## 9. Нагадування

Окремого ендпоінта немає: фронт сам збирає нагадування з `/vehicles`, `/drivers`, `/trips`, `/tasks` і `/{owner}/documents/summary` (`frontend/src/js/utils/reminders.js`):
- страховка машини закінчується за ≤ 30 днів або прострочена; до ТО ≤ 3000 км
- документи (машини, водії) з терміном дії, що минає або минув
- прострочені оплати (менеджер — своїх рейсів, керівник — усіх)
- рейси на найближчі 2 дні без машини чи водія; зламана машина в запланованих рейсах
- прострочені завдання

З нагадування можна створити завдання звичайним `POST /tasks` (з `tripId`, якщо воно про рейс). Пізніше сервер може надсилати ці ж нагадування на пошту чи у Viber.

---

## Відкриті питання

- [x] Логістична платформа — Della: парсинг сторінки пошуку (див. розділ 2, «Імпорт вантажу з Della»); Іра робить `GET /import/della`
- [ ] Формула ЗП водія: за км, % від рейсу чи фіксована ставка
- [ ] Ціна пального: константа в налаштуваннях чи окремий ендпоінт `/settings`
- [x] Ролі: `owner` і `manager` (розділ 8, «Ролі»)
- [ ] Хто може оновлювати код запрошення: будь-хто чи лише `owner`
- [ ] Зберігання токена: перейти з `localStorage` на `HttpOnly`-cookie (див. «Загальні правила»)
