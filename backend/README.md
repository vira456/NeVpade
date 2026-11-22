# Backend NeVpade (Іра)

Серверна частина: **Python 3.11+ · FastAPI · MongoDB Atlas (хмара) · JWT · вхід через Google**.
Формат запитів і відповідей відповідає `docs/api-contract.md` та API-шару фронтенду (`frontend/src/js/api/`, гілка `frontend-dev`).

## Структура

```
backend/
├── main.py                 точка входу (uvicorn main:app)
├── seed.py                 демо-дані для показу
├── requirements.txt
├── .env.example            шаблон налаштувань → скопіювати в .env
├── app/
│   ├── main.py             створення FastAPI, CORS, підключення роутерів
│   ├── config.py           налаштування зі змінних середовища
│   ├── db.py               підключення до MongoDB Atlas, індекси
│   ├── errors.py           єдиний формат помилок { detail, code }
│   ├── security.py         bcrypt-паролі, JWT, хешування кодів
│   ├── deps.py             поточний користувач за Bearer-токеном
│   ├── utils.py            _id → id, дати, телефони
│   ├── schemas/            Pydantic-моделі (валідація, camelCase у JSON)
│   ├── services/           бізнес-логіка: розрахунок рейсу, аналітика, коди,
│   │                       пошта/SMS, перевірка Google, CRUD-фабрика
│   └── routers/            ендпоінти: auth, profile, company, chat, trips,
│                           vehicles, drivers, tasks, analytics
└── tests/                  модульні тести логіки (pytest)
```

Архітектура трирівнева: **роутери** (HTTP) → **сервіси** (бізнес-логіка) → **MongoDB**.
Усі дані належать компанії: менеджер бачить лише рейси, авто й водіїв своєї компанії; завдання Kanban — особисті.

## Локальний запуск

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env           # macOS/Linux: cp .env.example .env
# заповнити .env (мінімум: MONGODB_URI і JWT_SECRET)
uvicorn main:app --reload
```

- API: http://localhost:8000/api
- Swagger (інтерактивна документація): http://localhost:8000/docs
- Перевірка зв'язку з БД і налаштувань пошти: http://localhost:8000/api/health → `{ status, email, emailReady, sms }`

Фронтенд: у `frontend/.env` поставити `VITE_USE_MOCK=false`, `VITE_API_URL=http://localhost:8000/api`
і той самий `VITE_GOOGLE_CLIENT_ID`, що й `GOOGLE_CLIENT_ID` бекенду.

### Коди підтвердження без реальної пошти/SMS

За замовчуванням `EMAIL_PROVIDER=console` і `SMS_PROVIDER=console`: коди не надсилаються, а пишуться в
консоль сервера (`[EMAIL → ...] ... 123456`). Для захисту курсової можна задати фіксовані коди:
`DEV_FIXED_EMAIL_CODE` — для листів, `DEV_FIXED_SMS_CODE` — для SMS, `DEV_FIXED_CODE` — для обох одразу
(напр. справжні коди на пошту + `DEV_FIXED_SMS_CODE=123456`, поки SMS не налаштовано). **Для реальних користувачів не вмикати.**

### Демо-дані

Після реєстрації через сайт:
```bash
python seed.py ваш@email.com           # 6 авто, 6 водіїв, 9 рейсів, 6 завдань
python seed.py ваш@email.com --reset   # спершу очистити дані компанії
```

### Тести
```bash
python -m pytest
```

## Хмара

### 1. MongoDB Atlas (база даних)
1. https://www.mongodb.com/cloud/atlas/register → створити безкоштовний кластер **M0** (регіон Frankfurt).
2. *Database Access* → користувач з паролем (роль *Read and write to any database*).
3. *Network Access* → **Allow access from anywhere (0.0.0.0/0)** — Render не має фіксованої IP-адреси.
4. *Connect → Drivers → Python* → скопіювати рядок `mongodb+srv://...` у `MONGODB_URI`, підставивши пароль.

### 2. Google Sign-In
1. https://console.cloud.google.com → створити проєкт → *APIs & Services → OAuth consent screen* (External, додати свій email як тестового користувача).
2. *Credentials → Create credentials → OAuth client ID → Web application*.
3. **Authorized JavaScript origins**: `http://localhost:5173` і адреса фронтенду в мережі (напр. `https://nevpade.vercel.app`).
4. Client ID → у `GOOGLE_CLIENT_ID` (бекенд) і `VITE_GOOGLE_CLIENT_ID` (фронт). Секрет не потрібен: бекенд лише перевіряє підпис ID-токена.

### 3. Пошта
Безкоштовний Render блокує SMTP-порти, тому листи йдуть через HTTP API одного з сервісів (`EMAIL_PROVIDER`).
Для всіх: `EMAIL_FROM` — підтверджена в сервісі адреса відправника, `EMAIL_FROM_NAME=NeVpade`.

| `EMAIL_PROVIDER` | Ключі | Примітка |
|---|---|---|
| `mailjet` | `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | достатньо підтвердити одну адресу відправника (можна Gmail) |
| `resend` | `RESEND_API_KEY` | потрібен власний домен; без нього — листи лише на свою пошту |
| `brevo` | `BREVO_API_KEY` | достатньо підтвердити адресу відправника |
| `smtp` | `SMTP_USER`, `SMTP_PASSWORD` (пароль застосунку Google) | лише локально — на Render SMTP заблоковано |

Листи від адреси `@gmail.com` через сторонній сервіс можуть потрапляти в «Спам» — надійніше з власного домену.

### 4. SMS (необов'язково)
Справжні SMS платні: TurboSMS (`SMS_PROVIDER=turbosms`, `TURBOSMS_TOKEN`, `TURBOSMS_SENDER`).
Без цього — `SMS_PROVIDER=console` + `DEV_FIXED_SMS_CODE`.

### 5. Деплой бекенду на Render (безкоштовно)
1. Злити гілку `backend-dev` у `main` (або змінити `branch` у `render.yaml`).
2. https://render.com → *New → Blueprint* → вибрати репозиторій — Render прочитає `render.yaml`.
3. Ввести значення змінних (`MONGODB_URI`, `CORS_ORIGINS` = адреса фронтенду, `GOOGLE_CLIENT_ID`, `EMAIL_FROM`, `BREVO_API_KEY`).
4. Адреса API буде на кшталт `https://nevpade-api.onrender.com/api` → її в `VITE_API_URL` фронтенду.

Безкоштовний сервіс «засинає» після 15 хв без запитів; перший запит після цього триває ~30–50 с.

## Ендпоінти

| Розділ | Ендпоінти |
|---|---|
| Авторизація | `POST /auth/register`, `/auth/verify-email`, `/auth/phone`, `/auth/verify-phone`, `/auth/resend-code`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google`, `/auth/complete-signup`, `/auth/join-request`, `/auth/change-password`; `GET /auth/me` |
| Профіль | `GET/PUT /profile`, `PUT/DELETE /profile/avatar`, `GET /profile/kpi`, `GET/PATCH /profile/settings` |
| Компанія | `GET/PATCH /company`, `POST /company/invite`, `POST /company/switch`, `GET/POST /company/chat?after=<id>` |
| Команда | `GET /company/members`, `GET /company/members/{id}`, `GET /company/members/{id}/kpi`, `DELETE /company/members/{id}?transferTo=` |
| Заявки на вступ | `GET /company/join-requests`, `POST /company/join-requests/{id}/approve`, `…/reject` |
| Рейси | `GET /trips?status=&search=&mine=`, `GET/PUT/DELETE /trips/{id}`, `POST /trips`, `PATCH /trips/{id}/payment`, `POST /trips/{id}/calculate`, `POST /trips/{id}/transfer`, `POST /trips/import` |
| Клієнти | CRUD `/clients` |
| Автопарк | CRUD `/vehicles`, `PATCH /vehicles/{id}/status` |
| Водії | CRUD `/drivers`, `PUT /drivers/{id}/vehicle` |
| Документи | `GET/POST /vehicles/{id}/documents`, `DELETE /vehicles/{id}/documents/{docId}`, `GET /vehicles/documents/summary` (так само для `/drivers` і `/trips`); файл — `GET /files/{docId}?token=` |
| Viber замовнику | `POST /trips/{id}/client-message` → `{ phone, text, viberUrl, forwardUrl, shareUrl, expiresAt, documents, warnings }`; сторінка для замовника — `GET /share/{code}` (без входу) |
| Імпорт з Della | `GET /import/della?path=/search/….html` → `{ html }` |
| Завдання | `GET/POST /tasks`, `PUT/PATCH/DELETE /tasks/{id}`, `PUT /tasks/reorder` |
| Аналітика | `GET /analytics/summary|income|expenses|drivers?period=week|month|year`, `GET /analytics/team?period=month|year` (власник) |
| Пальне | `GET /fuel-price` → `{ diesel, date, source, sourceUrl, updatedAt, isFallback }` |

Повний опис полів — у Swagger (`/docs`).

### Ролі й авторизація
Дві ролі — два інтерфейси. **Власник** (`owner`) створює компанію й лише переглядає її роботу (рейси, клієнтів,
аналітику); у нього кабінет: огляд і `GET /analytics/team`, менеджери, заявки на вступ, назва компанії, код компанії,
звільнення менеджера. **Менеджер** (`manager`) веде рейси, клієнтів, автопарк, водіїв, завдання.
Зміни від власника → `403 manager_only`, дії кабінету від менеджера → `403 owner_only`. Роль і статус читаються з бази
на кожному запиті, тож зміна діє одразу.

- **Власник**: `register` (`role: "owner"`, `company.mode: "create"`) → лист → `verify-email` → SMS → `verify-phone` → токен.
  Вхід — пошта + пароль або Google (`role: "owner"`, без коду компанії).
- **Менеджер**: `register` з кодом компанії (`join`) → … → `verify-phone` → заявка власнику, `memberStatus: "pending"`;
  до рішення власника ендпоінти даних → `403 membership_pending`. Відхилили — `POST /auth/join-request` з іншим кодом.
  Вхід — пошта + пароль + **код компанії** (`companyCode`; хибний → `401 invalid_company_code`).
- **Код компанії** (`NVP-1234`) бачить і змінює лише власник (`POST /company/invite`). Після зміни старий код не діє ні для
  реєстрації, ні для входу, а відкриті сесії менеджерів закриваються (`401 token_invalid`) — вони входять з новим кодом.
- **Захист від підбору**: 5 невдалих спроб входу поспіль (пароль чи код компанії) → пауза 15 хв (`429 too_many_attempts`);
  відновлення пароля знімає паузу. Токен діє 12 год (`JWT_EXPIRE_HOURS`).
- **Google** — для обох ролей, `POST /auth/google { credential, role, companyCode? }`. Новий користувач (`isNew: true`)
  на кроці «Завершіть реєстрацію» (`/auth/complete-signup`): менеджер — ім'я, код компанії й телефон (`join`);
  власник (`role: "owner"`) — ім'я, назва й місто компанії, телефон (`create`; від менеджера → `400 owner_only`).
  Наявний менеджер входить через Google лише з кодом компанії; вкладка не тієї ролі → `403 wrong_role`.
  Акаунт без пароля (лише Google) при вході паролем → `401 use_google` (пароль можна задати в профілі).
- Менеджер, якого прибрали з компанії, при вході отримує `403 not_in_company`; його активні рейси переходять іншому менеджеру.

### Рішення щодо відкритих питань контракту
- **ЗП водія** — за км (`ratePerKm` водія).
- **Ціна пального** — ринкова середня ціна дизеля по АЗС України з https://index.minfin.com.ua/markets/fuel/ (дані Консалтингової групи А-95): сервер оновлює її раз на 12 год і зберігає в MongoDB (колекція `meta`). Менеджер може задати власну (`PATCH /profile/settings { "fuelPrice": 60 }`, `null` — повернутися до ринкової). Якщо сайт недоступний — остання відома ціна, а без неї — `DEFAULT_FUEL_PRICE`.
- **Інші витрати** — ремонт і ТО 2,2 грн/км + дороги 1,1 грн/км + 350 грн на рейс (як у `frontend/src/js/utils/economics.js`; так рахується й структура витрат в аналітиці).
- **Аналітика** — лише рейси `done` і `in_progress`; поточний період порівнюється з таким самим відрізком попереднього (1–11 листопада ↔ 1–11 жовтня).
- **Ролі** — див. «Ролі й авторизація» вище; ролі не змінюються: власник компанії один, передати компанію не можна.
- **Імпорт рейсів** — фронт розбирає сторінку Della сам і створює рейси через `POST /trips` (`source: "import"`, `importedFrom`); бекенд лише віддає HTML через `GET /import/della` (лише `/search/…`, кеш 60 с, не частіше раз на 15 с). `POST /trips/import` лишився для пакетного імпорту.
- **Телефон** — поки він не підтверджений, усі ендпоінти даних повертають 403 `phone_not_verified` (працюють лише `/auth/*` і `/auth/me`).
- **Документи** — файли до 10 МБ зберігаються в MongoDB (колекції `documents` і `files`); тип визначається за вмістом (JPG/PNG/WEBP/PDF), посилання на файл підписане й діє 2 години.
- **Viber замовнику** — сервер не пише у Viber сам (бот не може першим написати тому, хто на нього не підписаний;
  Viber Business Messages платні й потребують ФОП/юрособи). `POST /trips/{id}/client-message` готує перше повідомлення
  (хто пише, вантаж, дата й адреса завантаження, водій з телефоном, номер і модель авто, посилання на документи, питання
  про час завантаження) і `viberUrl` = `viber://chat?number=%2B380…&draft=<текст>`: фронт відкриває Viber одразу в чаті з
  номером замовника (з картки клієнта або `trip.client.phone`), текст уже набрано. Номера немає → `viberUrl: null`,
  є `forwardUrl` (`viber://forward?text=…`, вибір контакту). `shareUrl` — коротке посилання `/api/share/<код>` (колекція
  `shares`, діє 7 днів, повторне натискання — те саме посилання): сторінка з водієм, авто, менеджером і документами.
  Замовник бачить лише паспорт і посвідчення водія, техпаспорт, страховку, техогляд, ліцензію й договір оренди авто —
  найсвіжіший дійсний документ кожного типу (ІПН, медична довідка, тахограф і прострочені — ні). `warnings` — що варто
  виправити перед надсиланням (немає номера, водія/машини, документів, прострочені документи).
