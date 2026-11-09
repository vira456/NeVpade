# Backend (Іра)

Серверна частина NeVpade: Python + FastAPI + MongoDB.

Формат усіх запитів і відповідей — у `../docs/api-contract.md`.

Не забути:
- CORS для `http://localhost:5173` (адреса фронтенду у режимі розробки);
- перетворювати `_id` (ObjectId) у рядок `id` у відповідях;
- помилки повертати у форматі `{ "detail": "текст" }`.
