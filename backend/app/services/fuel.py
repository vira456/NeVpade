"""Ринкова ціна дизельного пального (середня по АЗС України).

Джерело — сторінка Мінфіну https://index.minfin.com.ua/markets/fuel/ (дані Консалтингової групи А-95).
Офіційного API немає, тож розбираємо HTML. Щоб не навантажувати сайт і не гальмувати розрахунки:
- ціна зберігається в MongoDB (колекція meta) і оновлюється не частіше ніж раз на FRESH_FOR;
- після невдалої спроби наступна — не раніше ніж через RETRY_AFTER;
- якщо сайт недоступний або змінив верстку — працюємо з останньою відомою ціною,
  а якщо її ще немає — з DEFAULT_FUEL_PRICE з налаштувань.
"""
import asyncio
import html
import logging
import re
from datetime import timedelta

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from ..config import settings
from ..utils import iso, now

log = logging.getLogger("nevpade.fuel")

SOURCE_URL = "https://index.minfin.com.ua/markets/fuel/"
SOURCE_NAME = "Мінфін / Консалтингова група А-95"
FRESH_FOR = timedelta(hours=12)
RETRY_AFTER = timedelta(hours=1)
_DOC_ID = "fuelPrice"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "uk-UA,uk;q=0.9",
}

# «Дизельное топливо | 101,00» (сторінка російською) або «Дизельне паливо | 101,00» (українською)
_DIESEL_RE = re.compile(r"Дизельн\w*\s+(?:топлив|палив)\w*\s*\|\s*(\d{2,3}[.,]\d{1,2})")
_DATE_RE = re.compile(r"на\s+(\d{2})\.(\d{2})\.(\d{4})")

_lock = asyncio.Lock()


def parse_diesel(page: str) -> tuple[float, str | None] | None:
    """HTML сторінки → (ціна дизеля, дата 'YYYY-MM-DD' або None). None — ціну не знайдено."""
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "|", text)).replace("\xad", "")  # \xad — м'який перенос
    text = re.sub(r"\s*\|[\s|]*", " | ", text)
    match = _DIESEL_RE.search(text)
    if not match:
        return None
    price = float(match.group(1).replace(",", "."))
    if not 20 <= price <= 300:  # захист від того, що розбір схопив не те число
        return None
    date_match = _DATE_RE.search(text[: match.start()][-400:])
    day = f"{date_match.group(3)}-{date_match.group(2)}-{date_match.group(1)}" if date_match else None
    return price, day


async def _download() -> tuple[float, str | None] | None:
    async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers=_HEADERS) as client:
        resp = await client.get(SOURCE_URL)
    if resp.status_code != 200:
        log.warning("Мінфін відповів %s", resp.status_code)
        return None
    parsed = parse_diesel(resp.text)
    if parsed is None:
        log.warning("Не вдалося знайти ціну дизеля на сторінці Мінфіну — можливо, змінилась верстка")
    return parsed


async def refresh(database: AsyncDatabase, *, force: bool = False) -> dict | None:
    """Оновлює збережену ціну, якщо вона застаріла. Повертає документ з ціною (або None, якщо його ще немає)."""
    async with _lock:  # паралельні запити не завантажують сторінку кілька разів
        doc = await database.meta.find_one({"_id": _DOC_ID})
        moment = now()
        if not force and doc:
            if doc.get("fetchedAt") and moment - doc["fetchedAt"] < FRESH_FOR:
                return doc
            if doc.get("lastAttemptAt") and moment - doc["lastAttemptAt"] < RETRY_AFTER:
                return doc
        try:
            parsed = await _download()
        except httpx.HTTPError as exc:
            log.warning("Мінфін недоступний: %s", exc)
            parsed = None
        update = {"lastAttemptAt": moment}
        if parsed:
            update |= {"diesel": parsed[0], "date": parsed[1], "fetchedAt": moment}
        await database.meta.update_one({"_id": _DOC_ID}, {"$set": update}, upsert=True)
        return await database.meta.find_one({"_id": _DOC_ID})


async def market_price(database: AsyncDatabase) -> dict:
    """{ diesel, date, source, sourceUrl, updatedAt, isFallback } — для GET /fuel-price і розрахунків."""
    doc = await refresh(database)
    if doc and doc.get("diesel"):
        return {"diesel": doc["diesel"], "date": doc.get("date"), "source": SOURCE_NAME, "sourceUrl": SOURCE_URL,
                "updatedAt": iso(doc.get("fetchedAt")), "isFallback": False}
    return {"diesel": settings.default_fuel_price, "date": None, "source": None, "sourceUrl": None,
            "updatedAt": None, "isFallback": True}


async def fuel_price_for(database: AsyncDatabase, user: dict) -> float:
    """Ціна пального для розрахунків: власна з налаштувань менеджера, інакше ринкова."""
    own = (user.get("settings") or {}).get("fuelPrice")
    if own:
        return float(own)
    return float((await market_price(database))["diesel"])
