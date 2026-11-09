# API-контракт NeVpade (чернетка v0.1)

Документ узгоджують фронтенд і бекенд. Мокові дані фронтенду (`frontend/src/js/mock/`) відповідають саме цим структурам, тому зміни в контракті треба вносити в обидва місця.

## Загальні правила

- Базова адреса: `http://localhost:8000/api`
- Формат: JSON, кодування UTF-8
- Назви полів: `camelCase`
- Дати: ISO 8601, `YYYY-MM-DD` (дата) або `YYYY-MM-DDTHH:mm:ssZ` (дата й час)
- Ідентифікатор: поле `id` (рядок). `_id` з MongoDB назовні не віддається
- Гроші: числа в гривнях (`24000`), відстань у км, вага в тоннах
- Авторизація: заголовок `Authorization: Bearer <token>` для всіх запитів, крім `/auth/login`
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
  "user": { "id": "usr_01", "name": "Олена Коваль", "email": "olena@nevpade.ua", "role": "manager" }
}
```
Далі це називається **AuthResponse**.

### POST `/auth/register` — реєстрація
```json
{ "name": "Олена Коваль", "email": "olena@nevpade.ua", "password": "secret123" }
```
- Створює користувача з `emailVerified: false`, генерує 6-значний код і надсилає його листом
- Токен **не** видається, доки пошту не підтверджено
- Відповідь 201: `{ "email": "olena@nevpade.ua", "message": "Код підтвердження надіслано на пошту" }`
- 409 — email уже зареєстровано
- 422 — невалідні дані (пароль: мінімум 8 символів, літера й цифра)

### POST `/auth/verify-email` — підтвердження коду
```json
{ "email": "olena@nevpade.ua", "code": "123456" }
```
- 200 → **AuthResponse** (одразу входимо в систему)
- 400 `{ "detail": "Невірний код підтвердження", "code": "invalid_code" }`
- 400 `{ "detail": "Термін дії коду минув", "code": "code_expired" }`

### POST `/auth/resend-code` — надіслати код повторно
```json
{ "email": "olena@nevpade.ua", "purpose": "verify" }
```
- `purpose`: `verify` (підтвердження пошти) | `reset` (відновлення пароля)
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

### POST `/auth/google` — вхід через Google
```json
{ "credential": "<ID-токен від Google Identity Services>" }
```
- Бекенд перевіряє підпис токена (Python: `google.oauth2.id_token.verify_oauth2_token(credential, requests.Request(), GOOGLE_CLIENT_ID)`), бере `email`, `name`, `sub`
- Якщо користувача з таким email нема — створює (пошта вважається підтвердженою), якщо є — прив'язує `googleId`
- 200 → **AuthResponse**; 401 — токен недійсний

### POST `/auth/facebook` — вхід через Facebook
```json
{ "accessToken": "<токен від Facebook SDK>" }
```
- Бекенд перевіряє токен запитом `GET https://graph.facebook.com/me?fields=id,name,email&access_token=...`
- Далі логіка як у Google (поле `facebookId`). Якщо Facebook не віддав email — 400 з поясненням
- 200 → **AuthResponse**

### GET `/auth/me`
Потребує токен. Повертає `user` поточного користувача.

### Вимоги до кодів (для бекенду)
- 6 цифр, дійсний 10 хвилин, після використання видаляється
- Зберігати в БД хеш коду, а не сам код; максимум 5 спроб введення
- Лист надсилати через SMTP (наприклад, Gmail з паролем застосунку) або сервіс на кшталт SendGrid / Brevo

### Спільні ключі
`GOOGLE_CLIENT_ID` (Google Cloud Console → OAuth client ID, тип Web, Authorized JavaScript origins: `http://localhost:5173`) і `FACEBOOK_APP_ID` однакові для фронту й бекенду. Фронт тримає їх у `frontend/.env`, бекенд — у своєму `.env`.

---

## 2. Рейси `/trips`

| Метод | URL | Опис |
|---|---|---|
| GET | `/trips?status=planned&search=Львів` | список (фільтри необов'язкові) |
| GET | `/trips/{id}` | один рейс |
| POST | `/trips` | створити |
| PUT | `/trips/{id}` | оновити |
| DELETE | `/trips/{id}` | видалити |
| POST | `/trips/{id}/calculate` | розрахунок вартості, пального, ЗП |
| POST | `/trips/import` | запуск парсингу рейсів з логістичної платформи |

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
  "client": { "name": "ТОВ «БудСервіс»", "phone": "+380671234567" },
  "price": 24000,
  "distanceKm": 240,
  "status": "planned",
  "source": "manual",
  "createdAt": "2026-11-09T10:00:00Z"
}
```
- `status`: `planned` | `in_progress` | `done` | `cancelled`
- `source`: `manual` | `import`
- При POST/PUT поля `id` і `createdAt` не надсилаються

Відповідь `POST /trips/{id}/calculate`:
```json
{
  "distanceKm": 240,
  "fuelLiters": 76.8,
  "fuelCost": 4224,
  "driverSalary": 2400,
  "otherCosts": 800,
  "totalCost": 7424,
  "profit": 16576
}
```

---

## 3. Автопарк `/vehicles`

CRUD: GET (список), GET `/{id}`, POST, PUT `/{id}`, DELETE `/{id}`.

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
  "status": "on_trip"
}
```
- `status`: `available` | `on_trip` | `repair`
- `fuelConsumption` — л/100 км

---

## 4. Водії `/drivers`

CRUD аналогічно до автопарку.

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

---

## 5. Завдання (Kanban) `/tasks`

| Метод | URL | Опис |
|---|---|---|
| GET | `/tasks` | усі завдання |
| POST | `/tasks` | створити |
| PUT | `/tasks/{id}` | оновити повністю |
| PATCH | `/tasks/{id}` | часткове оновлення, напр. `{ "status": "done", "order": 0 }` |
| DELETE | `/tasks/{id}` | видалити |

```json
{
  "id": "tsk_01",
  "title": "Підтвердити завантаження TR-0042",
  "description": "Зателефонувати клієнту",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-11-14",
  "tripId": "trp_001",
  "order": 0
}
```
- `status`: `todo` («Маю зробити») | `in_progress` («В процесі») | `done` («Зроблено»)
- `priority`: `low` | `medium` | `high`

---

## 6. Аналітика `/analytics`

### GET `/analytics/summary?period=month`
```json
{ "income": 412000, "expenses": 268000, "profit": 144000, "tripsCount": 18, "distanceKm": 7350 }
```

### GET `/analytics/income?period=year`
`period`: `week` | `month` | `year`
```json
{
  "labels": ["Січ", "Лют", "Бер"],
  "income":   [310000, 295000, 342000],
  "expenses": [205000, 198000, 221000]
}
```

### GET `/analytics/expenses?period=month`
```json
{ "fuel": 152000, "salary": 78000, "repair": 21000, "tolls": 9000, "other": 8000 }
```

### GET `/analytics/drivers?period=month`
```json
[ { "driverId": "drv_01", "name": "Петро Іваненко", "trips": 6, "income": 138000 } ]
```

---

## Відкриті питання

- [ ] Яка саме логістична платформа для парсингу (Della?) і які поля з неї беремо
- [ ] Формула ЗП водія: за км, % від рейсу чи фіксована ставка
- [ ] Ціна пального: константа в налаштуваннях чи окремий ендпоінт `/settings`
- [ ] Чи потрібні ролі, окрім `manager`
