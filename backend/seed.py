"""Наповнює компанію користувача демо-даними (авто, водії, рейси, завдання) — для показу на захисті.

Використання (з папки backend, після реєстрації користувача через сайт):
    python seed.py manager@example.com           # додати демо-дані
    python seed.py manager@example.com --reset   # спершу видалити всі рейси/авто/водіїв/завдання компанії
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


def parse_dt(value: str | None):
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
        sys.exit(f"Користувача {args.email} не знайдено або він ще не підтвердив пошту")
    company_id, me = user["companyId"], str(user["_id"])

    if args.reset:
        for name in ("vehicles", "drivers", "trips", "messages"):
            db[name].delete_many({"companyId": company_id})
        db.tasks.delete_many({"ownerId": user["_id"]})

    now = datetime.now(timezone.utc)
    ids: dict[str, str] = {}  # id з моків (veh_01) → новий ObjectId

    for v in DATA["vehicles"]:
        mock_id = v.pop("id")
        ids[mock_id] = str(db.vehicles.insert_one({**v, "companyId": company_id, "createdAt": now}).inserted_id)

    for d in DATA["drivers"]:
        mock_id = d.pop("id")
        d["vehicleId"] = ids.get(d.get("vehicleId"))
        ids[mock_id] = str(db.drivers.insert_one({**d, "companyId": company_id, "createdAt": now}).inserted_id)

    max_number = 0
    for t in DATA["trips"]:
        mock_id = t.pop("id")
        t.update(vehicleId=ids.get(t.get("vehicleId")), driverId=ids.get(t.get("driverId")), managerId=me,
                 companyId=company_id, createdAt=parse_dt(t.get("createdAt")), transferredAt=None)
        ids[mock_id] = str(db.trips.insert_one(t).inserted_id)
        max_number = max(max_number, int(t["number"].split("-")[-1]))
    db.companies.update_one({"_id": company_id, "tripCounter": {"$lt": max_number}}, {"$set": {"tripCounter": max_number}})

    for task in DATA["tasks"]:
        task.pop("id")
        task.update(tripId=ids.get(task.get("tripId")), ownerId=user["_id"], companyId=company_id,
                    createdAt=parse_dt(task.get("createdAt")))
        db.tasks.insert_one(task)

    print(f"Готово: {len(DATA['vehicles'])} авто, {len(DATA['drivers'])} водіїв, "
          f"{len(DATA['trips'])} рейсів, {len(DATA['tasks'])} завдань для {args.email}")


if __name__ == "__main__":
    main()
