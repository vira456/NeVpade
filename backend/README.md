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
│   │                       пошта/SMS, перевірка Google/Facebook, CRUD-фабрика
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
- Перевірка зв'язку з БД: http://localhost:8000/api/health

Фронтенд: у `frontend/.env` поставити `VITE_USE_MOCK=false`, `VITE_API_URL=http://localhost:8000/api`
і той самий `VITE_GOOGLE_CLIENT_ID`, що й `GOOGLE_CLIENT_ID` бекенду.

### Коди підтвердження без реальної пошти/SMS

За замовчуванням `EMAIL_PROVIDER=console` і `SMS_PROVIDER=console`: коди не надсилаються, а пишуться в
консоль сервера (`[EMAIL → ...] ... 123456`). Для захисту курсової можна задати `DEV_FIXED_CODE=123456` —
тоді всі коди однакові (як у мок-режимі фронтенду). **Для реальних користувачів не вмикати.**

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

### 3. Пошта (Brevo, безкоштовно 300 листів/день)
Безкоштовний Render блокує SMTP-порти, тому листи йдуть через HTTP API Brevo:
https://www.brevo.com → *Senders* → підтвердити свій email → *SMTP & API → API keys* → ключ у `BREVO_API_KEY`,
`EMAIL_PROVIDER=brevo`, `EMAIL_FROM=підтверджений@email`.
Локально можна й Gmail: `EMAIL_PROVIDER=smtp`, `SMTP_USER`, `SMTP_PASSWORD` = пароль застосунку Google.

### 4. SMS (необов'язково)
Справжні SMS платні: TurboSMS (`SMS_PROVIDER=turbosms`, `TURBOSMS_TOKEN`, `TURBOSMS_SENDER`).
Без цього — `SMS_PROVIDER=console` + `DEV_FIXED_CODE`.

### 5. Деплой бекенду на Render (безкоштовно)
1. Злити гілку `backend-dev` у `main` (або змінити `branch` у `render.yaml`).
2. https://render.com → *New → Blueprint* → вибрати репозиторій — Render прочитає `render.yaml`.
3. Ввести значення змінних (`MONGODB_URI`, `CORS_ORIGINS` = адреса фронтенду, `GOOGLE_CLIENT_ID`, `EMAIL_FROM`, `BREVO_API_KEY`).
4. Адреса API буде на кшталт `https://nevpade-api.onrender.com/api` → її в `VITE_API_URL` фронтенду.

Безкоштовний сервіс «засинає» після 15 хв без запитів; перший запит після цього триває ~30–50 с.

## Ендпоінти

| Розділ | Ендпоінти |
|---|---|
| Авторизація | `POST /auth/register`, `/auth/verify-email`, `/auth/phone`, `/auth/verify-phone`, `/auth/resend-code`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google`, `/auth/facebook`, `/auth/change-password`; `GET /auth/me` |
| Профіль | `GET/PUT /profile`, `PUT/DELETE /profile/avatar`, `GET /profile/kpi`, `GET/PATCH /profile/settings` |
| Компанія | `GET/PUT /company`, `GET /company/members`, `POST /company/invite`, `GET/POST /company/chat?after=<id>` |
| Рейси | `GET /trips?status=&search=&mine=`, `GET/PUT/DELETE /trips/{id}`, `POST /trips`, `POST /trips/{id}/calculate`, `POST /trips/{id}/transfer`, `POST /trips/import` |
| Автопарк | CRUD `/vehicles`, `PATCH /vehicles/{id}/status` |
| Водії | CRUD `/drivers`, `PUT /drivers/{id}/vehicle` |
| Документи | `GET/POST /vehicles/{id}/documents`, `DELETE /vehicles/{id}/documents/{docId}`, `GET /vehicles/documents/summary` (так само для `/drivers`); файл — `GET /files/{docId}?token=` |
| Імпорт з Della | `GET /import/della?path=/search/….html` → `{ html }` |
| Завдання | `GET/POST /tasks`, `PUT/PATCH/DELETE /tasks/{id}`, `PUT /tasks/reorder` |
| Аналітика | `GET /analytics/summary|income|expenses|drivers?period=week|month|year` |

Повний опис полів — у Swagger (`/docs`).

### Сценарії авторизації
- **Email**: `register` → лист з кодом → `verify-email` → SMS → `verify-phone` → токен.
  Компанія створюється (або користувач приєднується за кодом `NVP-1234`) після підтвердження пошти.
- **Google/Facebook**: токен видається одразу; новому користувачу створюється власна компанія, а пошта вважається
  підтвердженою. Номер телефону додається окремо (`/auth/phone` → `/auth/verify-phone`) протягом 30 хв після входу.
- Хтось почав реєстрацію з чужим email і не підтвердив його → при вході справжнього власника через Google ці дані скидаються.

### Рішення щодо відкритих питань контракту
- **ЗП водія** — за км (`ratePerKm` водія). **Ціна пального** — у налаштуваннях менеджера (`/profile/settings`, поле `fuelPrice`, типово 56 грн/л).
- **Інші витрати** — 3,5 грн/км: дороги/стоянки 1,2 + ремонт/амортизація 1,3 + інше 1,0 (так рахується й структура витрат в аналітиці).
- **Ролі** — `owner` (створив компанію: міняє код запрошення, назву, будь-які рейси) і `manager`.
- **Імпорт рейсів** — фронт розбирає сторінку Della сам і створює рейси через `POST /trips` (`source: "import"`, `importedFrom`); бекенд лише віддає HTML через `GET /import/della` (лише `/search/…`, кеш 60 с, не частіше раз на 15 с). `POST /trips/import` лишився для пакетного імпорту.
- **Телефон** — поки він не підтверджений, усі ендпоінти даних повертають 403 `phone_not_verified` (працюють лише `/auth/*` і `/auth/me`).
- **Документи** — файли до 10 МБ зберігаються в MongoDB (колекції `documents` і `files`); тип визначається за вмістом (JPG/PNG/WEBP/PDF), посилання на файл підписане й діє 2 години.
