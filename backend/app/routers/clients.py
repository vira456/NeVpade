"""Розділ 2б контракту: клієнти (замовники перевезень) /clients."""
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, require_owner
from ..errors import ApiError
from ..schemas.entities import ClientIn, ClientOut, ClientUpdate
from ..services.crud import crud_router
from ..utils import squash


async def _validate(database: AsyncDatabase, user: dict, data: dict, existing: dict | None) -> None:
    if "name" in data:
        data["name"] = squash(data["name"])
    if data.get("edrpou"):
        query = {**company_filter(user), "edrpou": data["edrpou"]}
        if existing is not None:
            query["_id"] = {"$ne": existing["_id"]}
        if await database.clients.find_one(query, {"_id": 1}):
            raise ApiError(409, "Клієнт з таким ЄДРПОУ вже є", "edrpou_taken")


async def _after_write(database: AsyncDatabase, user: dict, doc: dict) -> None:
    # У рейсах зберігається знімок client { name, phone } — оновлюємо, щоб усюди була актуальна назва
    await database.trips.update_many(
        {**company_filter(user), "clientId": str(doc["_id"])},
        {"$set": {"client": {"name": doc.get("name", ""), "phone": doc.get("phone")}}},
    )


async def _before_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    require_owner(user, "Видаляти клієнтів може лише керівник")
    count = await database.trips.count_documents({**company_filter(user), "clientId": str(doc["_id"])})
    if count:  # історію рейсів не губимо
        raise ApiError(409, f"У клієнта є рейси ({count}) — його не можна видалити", "client_has_trips")


router = crud_router(
    collection="clients",
    prefix="/clients",
    tag="Клієнти",
    in_model=ClientIn,
    update_model=ClientUpdate,
    out_model=ClientOut,
    what="Клієнта",
    validate=_validate,
    after_write=_after_write,
    before_delete=_before_delete,
    nullable=frozenset({"edrpou", "email", "phone"}),
)
