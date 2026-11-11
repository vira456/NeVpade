"""Налаштування застосунку. Усі значення беруться зі змінних середовища (або з файлу backend/.env)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # python-dotenv необов'язковий: на хостингу змінні задаються в панелі керування
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover
    pass


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    return [item.strip().rstrip("/") for item in os.getenv(name, default).split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # --- База даних (MongoDB Atlas) ---
    mongodb_uri: str = os.getenv("MONGODB_URI", "")
    mongodb_db: str = os.getenv("MONGODB_DB", "nevpade")

    # --- JWT ---
    jwt_secret: str = os.getenv("JWT_SECRET", "")
    jwt_expire_hours: int = int(os.getenv("JWT_EXPIRE_HOURS", "168"))  # 7 днів

    # --- CORS: адреси фронтенду через кому ---
    cors_origins: list[str] = field(
        default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )

    # --- Соцмережі ---
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    facebook_app_id: str = os.getenv("FACEBOOK_APP_ID", "")
    facebook_app_secret: str = os.getenv("FACEBOOK_APP_SECRET", "")

    # --- Пошта: brevo (HTTP API, працює на будь-якому хостингі) | smtp | console ---
    email_provider: str = os.getenv("EMAIL_PROVIDER", "console").lower()
    email_from: str = os.getenv("EMAIL_FROM", "")
    email_from_name: str = os.getenv("EMAIL_FROM_NAME", "NeVpade")
    brevo_api_key: str = os.getenv("BREVO_API_KEY", "")
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")

    # --- SMS: turbosms | console ---
    sms_provider: str = os.getenv("SMS_PROVIDER", "console").lower()
    turbosms_token: str = os.getenv("TURBOSMS_TOKEN", "")
    turbosms_sender: str = os.getenv("TURBOSMS_SENDER", "")

    # --- Режим демонстрації: фіксований код замість випадкового (НЕ вмикати для реальних користувачів) ---
    dev_fixed_code: str = os.getenv("DEV_FIXED_CODE", "")

    # --- Бізнес-налаштування за замовчуванням ---
    default_fuel_price: float = float(os.getenv("DEFAULT_FUEL_PRICE", "56"))  # грн/л

    debug: bool = _bool("DEBUG", False)


settings = Settings()
