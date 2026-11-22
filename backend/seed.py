"""Наповнює компанію користувача демо-даними (машини, водії, клієнти, рейси, завдання) — для показу на захисті.

Дані ті самі, що в моках фронтенду (frontend/src/js/mock), тож сайт з бекендом виглядає так само, як у демо.

Використання (з папки backend, після реєстрації користувача через сайт):
    python seed.py manager@example.com           # додати демо-дані
    python seed.py manager@example.com --reset   # спершу видалити всі дані компанії й завдання користувача
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import certifi
from pymongo import MongoClient

from app.config import settings

DATA = json.loads((Path(__file__).parent / "app" / "seed_data.json").read_text(encoding="utf-8"))
COMPANY_COLLECTIONS = ("vehicles", "drivers", "clients", "trips", "messages", "documents", "files")


def parse_dt(value: str | None) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else datetime.now(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email", help="email користувача, у чию компанію додати дані")
    parser.add_argument("--reset", action="store_true", help="видалити наявні дані компанії перед заповненням")
    args = parser.parse_args()

    kwargs = {"tlsCAFile": certifi.where()} if settings.mongodb_uri.startswith("mongodb+srv://") else {}
    db = MongoClient(settings.mongodb_uri, tz_aware=True, **kwargs)[settings.mongodb_db]

    user = db.users.find_one({"email": args.email.lower()})
    if not user or not user.get("companyId"):
        sys.exit(f"Користувача {args.email} не знайдено або він ще не завершив реєстрацію")
    company_id, me = user["companyId"], str(user["_id"])

    if args.reset:
        for name in COMPANY_COLLECTIONS:
            db[name].delete_many({"companyId": company_id})
        db.tasks.delete_many({"ownerId": user["_id"]})

    now = datetime.now(timezone.utc)
    ids: dict[str, str] = {}  # id з моків (veh_01, cli_03, trp_042) → новий ObjectId

    def insert(collection: str, doc: dict) -> None:
        mock_id = doc.pop("id")
        ids[mock_id] = str(db[collection].insert_one({**doc, "companyId": company_id}).inserted_id)

    for v in DATA["vehicles"]:
        insert("vehicles", {**v, "createdAt": now, "statusUpdatedAt": parse_dt(v.get("statusUpdatedAt"))})
    for d in DATA["drivers"]:
        insert("drivers", {**d, "vehicleId": ids.get(d.get("vehicleId")), "createdAt": now})
    for c in DATA["clients"]:
        insert("clients", {**c, "createdAt": parse_dt(c.get("createdAt"))})

    max_number = 0
    for t in DATA["trips"]:
        # у демо рейси різних менеджерів — тут усі стають рейсами користувача, історія теж «його»
        history = [{**h, "by": me, **({"from": me, "to": me} if h.get("action") == "transferred" else {})}
                   for h in t.get("history", [])]
        insert("trips", {
            **t, "vehicleId": ids.get(t.get("vehicleId")), "driverId": ids.get(t.get("driverId")),
            "clientId": ids.get(t.get("clientId")), "managerId": me, "history": history,
            "createdAt": parse_dt(t.get("createdAt")), "transferredAt": None,
        })
        max_number = max(max_number, int(t["number"].split("-")[-1]))
    db.companies.update_one({"_id": company_id, "tripCounter": {"$lt": max_number}}, {"$set": {"tripCounter": max_number}})

    for task in DATA["tasks"]:
        task = {k: v for k, v in task.items() if k != "id"}
        db.tasks.insert_one({**task, "tripId": ids.get(task.get("tripId")), "ownerId": user["_id"], "companyId": company_id,
                             "createdAt": parse_dt(task.get("createdAt"))})

    counts = ", ".join(f"{len(DATA[k])} {label}" for k, label in
                       (("vehicles", "машин"), ("drivers", "водіїв"), ("clients", "клієнтів"), ("trips", "рейсів"), ("tasks", "завдань")))
    print(f"Готово: {counts} для {args.email}")


if __name__ == "__main__":
    main()
