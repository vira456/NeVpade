"""Спільний чат компанії. Фронт опитує GET /company/chat?after=<id> кожні кілька секунд."""
from fastapi import APIRouter, Depends, Query, status
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..schemas.common import CamelModel
from ..utils import is_oid, now, oid, public

router = APIRouter(prefix="/company/chat", tags=["Чат компанії"])

HISTORY_LIMIT = 100  # без after — останні 100 (контракт)


class MessageIn(CamelModel):
    text: str = Field(min_length=1, max_length=2000)


class MessageOut(CamelModel):
    id: str
    type: str | None = None  # None — звичайне повідомлення, "transfer" — передача рейсу
    author_id: str
    text: str
    trip_id: str | None = None
    to_id: str | None = None
    created_at: str


@router.get("", response_model=list[MessageOut], response_model_exclude_none=True)
async def get_messages(after: str | None = Query(None, description="id останнього отриманого повідомлення"),
                       user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    query = company_filter(user)
    if after and is_oid(after):
        # ObjectId зростають у часі, тож «після id» = «новіші за нього»
        query["_id"] = {"$gt": oid(after)}
        docs = await database.messages.find(query).sort("_id", 1).limit(HISTORY_LIMIT).to_list(None)
    else:
        docs = await database.messages.find(query).sort("_id", -1).limit(HISTORY_LIMIT).to_list(None)
        docs.reverse()
    return [public(d) for d in docs]


@router.post("", response_model=MessageOut, response_model_exclude_none=True, status_code=status.HTTP_201_CREATED)
async def send_message(body: MessageIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    doc = {"companyId": user["companyId"], "authorId": str(user["_id"]), "text": body.text, "createdAt": now()}
    result = await database.messages.insert_one(doc)
    doc["_id"] = result.inserted_id
    return public(doc)
