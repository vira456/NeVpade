"""Імпорт вантажів з біржі Della: бекенд завантажує HTML сторінки пошуку (браузер не може через CORS).

Фронт сам розбирає HTML і створює рейси звичайним POST /trips. Тут лише «посередник» з обмеженнями,
щоб ендпоінт не став відкритим проксі й не навантажував Della: лише шляхи /search/…, кеш 60 с,
не частіше одного запиту до Della на 15 с.
"""
import asyncio
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, Query

from ..deps import current_user
from ..errors import ApiError

log = logging.getLogger("nevpade.della")

router = APIRouter(prefix="/import", tags=["Імпорт з Della"])

DELLA = "https://della.ua"
CACHE_TTL = 60.0
MIN_INTERVAL = 15.0
_PATH_RE = re.compile(r"^/search/[A-Za-z0-9_\-./%]+$")
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "uk-UA,uk;q=0.9",
    "Referer": f"{DELLA}/",
}

_cache: dict[str, tuple[float, str]] = {}
_lock = asyncio.Lock()
_last_request = 0.0


@router.get("/della")
async def della_page(path: str = Query(..., max_length=500, description="/search/….html"), _: dict = Depends(current_user)):
    """{ html } сторінки пошуку Della."""
    global _last_request
    if not _PATH_RE.match(path) or ".." in path:
        raise ApiError(400, "Вставте посилання на сторінку пошуку Della (https://della.ua/search/….html)", "bad_url")

    hit = _cache.get(path)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return {"html": hit[1]}

    async with _lock:  # паралельні запити чекають один одного, а не б'ють по Della разом
        hit = _cache.get(path)
        if hit and time.monotonic() - hit[0] < CACHE_TTL:
            return {"html": hit[1]}
        wait = MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            raise ApiError(429, f"Della можна оновлювати раз на 15 с. Спробуйте через {int(wait) + 1} с", "too_many_requests")
        _last_request = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers=_HEADERS) as client:
                resp = await client.get(DELLA + path)
        except httpx.HTTPError as exc:
            log.warning("Della недоступна: %s", exc)
            raise ApiError(502, "Della не відповідає. Спробуйте пізніше", "della_unavailable") from None
        if resp.status_code != 200:
            raise ApiError(502, f"Della не відповідає (код {resp.status_code}). Спробуйте пізніше", "della_unavailable")
        html = resp.text
        _cache[path] = (time.monotonic(), html)
        # не тримаємо в пам'яті застарілі сторінки
        for key, (at, _) in list(_cache.items()):
            if time.monotonic() - at > CACHE_TTL:
                _cache.pop(key, None)
        return {"html": html}
