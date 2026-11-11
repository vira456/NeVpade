"""Паролі (bcrypt) та JWT-токени доступу."""
import hashlib
import hmac
import secrets
from datetime import timedelta

import bcrypt
import jwt

from .config import settings
from .utils import now

ALGORITHM = "HS256"


def _secret() -> str:
    if not settings.jwt_secret:
        raise RuntimeError("Не задано JWT_SECRET у backend/.env")
    return settings.jwt_secret


# ---------- Паролі ----------
def hash_password(password: str) -> str:
    # bcrypt враховує лише перші 72 байти — довші паролі спершу стискаємо SHA-256
    raw = password.encode()
    if len(raw) > 72:
        raw = hashlib.sha256(raw).hexdigest().encode()
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    raw = password.encode()
    if len(raw) > 72:
        raw = hashlib.sha256(raw).hexdigest().encode()
    try:
        return bcrypt.checkpw(raw, hashed.encode())
    except ValueError:
        return False


# ---------- JWT ----------
def create_token(user_id: str) -> str:
    issued = now()
    payload = {"sub": user_id, "iat": issued, "exp": issued + timedelta(hours=settings.jwt_expire_hours)}
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    """Повертає id користувача або None, якщо токен недійсний/прострочений."""
    try:
        payload = jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


# ---------- Одноразові коди ----------
def generate_code() -> str:
    if settings.dev_fixed_code:
        return settings.dev_fixed_code
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str, email: str, purpose: str) -> str:
    """У базі зберігаємо лише HMAC коду, а не сам код."""
    message = f"{email}:{purpose}:{code}".encode()
    return hmac.new(_secret().encode(), message, hashlib.sha256).hexdigest()


def codes_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
