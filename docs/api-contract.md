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
- Помилки: `{ "detail": "Текст помилки" }` з відповідним статусом

| Код | Значення |
|---|---|
| 200 | OK |
| 201 | Створено |
| 204 | Видалено (без тіла) |
| 400 | Некоректний запит |
| 401 | Не авторизовано / токен прострочений |
| 404 | Не знайдено |
| 422 | Помилка валідації |

---

## 1. Авторизація

### POST `/auth/login`
Запит:
```json
{ "email": "manager@nevpade.ua", "password": "secret123" }
```
Відповідь 200:
```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "usr_01", "name": "Олена Коваль", "role": "manager" }
}
```

### GET `/auth/me`
Повертає `user` поточного користувача.

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
