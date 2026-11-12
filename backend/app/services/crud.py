"""Узагальнений CRUD для сутностей компанії (автопарк, водії).

Фабрика `crud_router` створює 5 стандартних ендпоінтів. Усі запити обмежені компанією
поточного користувача — менеджер бачить і змінює лише дані своєї компанії.

Хуки (усі необов'язкові):
- validate(database, user, data, existing) — перевірити/доповнити дані перед записом
  (existing — поточний документ при оновленні, None при створенні);
- after_write(database, user, doc) — дії після створення чи оновлення;
- before_delete(database, user, doc) — може заборонити видалення (кинути ApiError);
- after_delete(database, user, doc) — прибрати пов'язані дані.
"""
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..errors import ApiError, not_found
from ..utils import drop_nulls, is_oid, now, oid, public

ValidateHook = Callable[[AsyncDatabase, dict, dict, dict | None], Awaitable[None]]
DocHook = Callable[[AsyncDatabase, dict, dict], Awaitable[None]]


async def ensure_ref(database: AsyncDatabase, user: dict, collection: str, ref_id: Any, what: str) -> None:
    """Перевіряє, що пов'язаний запис (авто, водій, рейс) існує в компанії користувача."""
    if ref_id in (None, ""):
        return
    if not is_oid(ref_id) or not await database[collection].find_one({"_id": oid(ref_id), **company_filter(user)}, {"_id": 1}):
        raise ApiError(422, f"{what} не знайдено у вашій компанії", "invalid_reference")


async def get_company_doc(database: AsyncDatabase, user: dict, collection: str, item_id: str, what: str) -> dict:
    doc = await database[collection].find_one({"_id": oid(item_id, what), **company_filter(user)})
    if doc is None:
        raise not_found(what)
    return doc


def crud_router(
    *,
    collection: str,
    prefix: str,
    tag: str,
    in_model: type[BaseModel],
    update_model: type[BaseModel],
    out_model: type[BaseModel],
    what: str,
    validate: ValidateHook | None = None,
    after_write: DocHook | None = None,
    before_delete: DocHook | None = None,
    after_delete: DocHook | None = None,
    nullable: frozenset[str] = frozenset(),
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    async def _get(database: AsyncDatabase, user: dict, item_id: str) -> dict:
        return await get_company_doc(database, user, collection, item_id, what)

    @router.get("", response_model=list[out_model])
    async def list_items(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
        cursor = database[collection].find(company_filter(user)).sort("createdAt", 1)
        return [public(doc) async for doc in cursor]

    @router.get("/{item_id}", response_model=out_model)
    async def get_item(item_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
        return public(await _get(database, user, item_id))

    @router.post("", response_model=out_model, status_code=status.HTTP_201_CREATED)
    async def create_item(body: in_model, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):  # type: ignore[valid-type]
        data = body.model_dump(by_alias=True)
        if validate:
            await validate(database, user, data, None)
        doc = {**data, "companyId": user["companyId"], "createdAt": now(), "createdBy": user["_id"]}
        result = await database[collection].insert_one(doc)
        doc["_id"] = result.inserted_id
        if after_write:
            await after_write(database, user, doc)
        return public(doc, "createdBy")

    @router.put("/{item_id}", response_model=out_model)
    async def update_item(item_id: str, body: update_model, user: dict = Depends(current_user),  # type: ignore[valid-type]
                          database: AsyncDatabase = Depends(db)):
        existing = await _get(database, user, item_id)
        data = drop_nulls(body.model_dump(by_alias=True, exclude_unset=True), nullable)
        if validate:
            await validate(database, user, data, existing)
        doc = await database[collection].find_one_and_update(
            {"_id": existing["_id"], **company_filter(user)},
            {"$set": {**data, "updatedAt": now()}},
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:  # запис видалили паралельним запитом
            raise not_found(what)
        if after_write:
            await after_write(database, user, doc)
        return public(doc, "createdBy", "updatedAt")

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(item_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
        doc = await _get(database, user, item_id)
        if before_delete:
            await before_delete(database, user, doc)
        await database[collection].delete_one({"_id": doc["_id"]})
        if after_delete:
            await after_delete(database, user, doc)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
