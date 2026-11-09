# NeVpade — інформаційна вебсистема для менеджера вантажоперевезень

Курсовий проєкт з дисципліни «Конструювання програмного забезпечення».

| Частина | Відповідальна | Технології |
|---|---|---|
| `frontend/` — клієнтська частина | (твоє ім’я) | HTML, SCSS, JavaScript (Vite), Chart.js, SortableJS, Google Maps API |
| `backend/` — серверна частина | Іра | Python (FastAPI), MongoDB |
| `docs/` — документація | спільно | API-контракт, діаграми |

## Структура

```
NeVpade/
├── frontend/          клієнтська частина (вебінтерфейс)
├── backend/           серверна частина (REST API + MongoDB)
├── docs/
│   └── api-contract.md   узгоджений формат запитів і відповідей
└── README.md
```

## Запуск фронтенду

```bash
cd frontend
npm install
copy .env.example .env      # Windows (на macOS/Linux: cp .env.example .env)
npm run dev
```

Відкрити http://localhost:5173

Режим роботи задається в `frontend/.env`:
- `VITE_USE_MOCK=true` — інтерфейс працює автономно на локальних мокових даних;
- `VITE_USE_MOCK=false` — запити йдуть на сервер за адресою `VITE_API_URL`.

## Запуск бекенду

```bash
cd backend
python -m venv venv
venv\Scripts\activate       # Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

API: http://localhost:8000/api, документація Swagger: http://localhost:8000/docs

## Робота з Git

- `main` — стабільна версія
- `frontend-dev` — гілка фронтенду
- `backend-dev` — гілка бекенду

Зміни потрапляють у `main` через Pull Request.
