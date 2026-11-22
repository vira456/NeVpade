"""Надсилання листів і SMS з кодами підтвердження.

Провайдер обирається в .env. У режимі `console` повідомлення лише пишеться в лог сервера —
так можна розробляти й тестувати без реальної пошти та SMS.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage

import httpx

from ..config import settings
from ..errors import ApiError

log = logging.getLogger("nevpade.notify")

_PURPOSE_TEXT = {
    "verify": ("Підтвердження пошти", "Ваш код підтвердження пошти в NeVpade"),
    "reset": ("Відновлення пароля", "Ваш код для зміни пароля в NeVpade"),
}


_CODE_TTL_NOTE = "Код дійсний 10 хвилин. Якщо ви не робили цей запит — просто проігноруйте лист."

# Які змінні потрібні кожному сервісу пошти (перевіряємо під час запуску, щоб помилку було видно одразу в логах)
_EMAIL_REQUIRED = {
    "brevo": ("BREVO_API_KEY", "EMAIL_FROM"),
    "mailjet": ("MAILJET_API_KEY", "MAILJET_SECRET_KEY", "EMAIL_FROM"),
    "resend": ("RESEND_API_KEY", "EMAIL_FROM"),
    "smtp": ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"),
}


def email_config_problem() -> str | None:
    """Чого бракує в налаштуваннях пошти (назви змінних, без значень) або None, якщо все задано."""
    provider = settings.email_provider
    if provider == "console":
        return "EMAIL_PROVIDER=console: листи не надсилаються, коди видно лише в логах сервера"
    if provider not in _EMAIL_REQUIRED:
        return f"Невідомий EMAIL_PROVIDER={provider} (можна: brevo, mailjet, resend, smtp, console)"
    missing = [name for name in _EMAIL_REQUIRED[provider] if not getattr(settings, name.lower())]
    return f"EMAIL_PROVIDER={provider}, але не задано: {', '.join(missing)}" if missing else None


def check_config() -> None:
    """Під час запуску пише в лог, куди підуть коди і чого бракує в налаштуваннях."""
    problem = email_config_problem()
    if problem:
        log.warning("Пошта: %s", problem)
    else:
        log.info("Пошта: %s, відправник %s", settings.email_provider, settings.email_from or settings.smtp_user)
    if settings.dev_fixed_email_code:
        log.warning("DEV_FIXED_EMAIL_CODE або DEV_FIXED_CODE задано: код з пошти завжди однаковий "
                    "(лише для демонстрації! Щоб коди були випадкові — видаліть обидві змінні)")
    if settings.sms_provider == "console":
        log.warning("SMS_PROVIDER=console: SMS не надсилаються, коди видно лише в логах сервера")


def _html(title: str, code: str, note: str = _CODE_TTL_NOTE) -> str:
    return f"""
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px">NeVpade · {title}</h2>
  <p>Ваш код:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:8px 0">{code}</p>
  <p style="color:#6b7280">{note}</p>
</div>"""


async def send_code_email(to: str, code: str, purpose: str) -> None:
    """Код підтвердження пошти або відновлення пароля."""
    title, lead = _PURPOSE_TEXT.get(purpose, _PURPOSE_TEXT["verify"])
    await _deliver(to, title, f"{lead}: {code}\nКод дійсний 10 хвилин.", _html(title, code), code)


async def _deliver(to: str, title: str, text: str, html: str, code: str) -> None:
    """Надсилає лист через сервіс з EMAIL_PROVIDER. У режимі console — лише рядок у лозі сервера."""
    provider = settings.email_provider
    if provider == "console":
        log.warning("[EMAIL → %s] %s: %s", to, title, code)
        return
    subject = f"NeVpade · {title}"
    senders = {"mailjet": _send_mailjet, "resend": _send_resend, "brevo": _send_brevo}
    try:
        if provider in senders:
            await senders[provider](to, subject, text, html)
        elif provider == "smtp":
            await asyncio.to_thread(_send_smtp, to, subject, text, html)
        else:
            raise RuntimeError(f"Невідомий EMAIL_PROVIDER: {provider}")
    except Exception as exc:  # noqa: BLE001
        log.exception("Не вдалося надіслати лист на %s", to)
        raise ApiError(502, "Не вдалося надіслати лист. Спробуйте пізніше", "email_failed") from exc


async def _post(url: str, provider: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, **kwargs)
    if resp.status_code >= 300:
        raise RuntimeError(f"{provider} {resp.status_code}: {resp.text[:300]}")
    return resp


async def _send_mailjet(to: str, subject: str, text: str, html: str) -> None:
    """Mailjet Send API v3.1: ключ і секретний ключ — у кабінеті Mailjet (Account settings → API keys)."""
    resp = await _post(
        "https://api.mailjet.com/v3.1/send", "Mailjet",
        auth=(settings.mailjet_api_key, settings.mailjet_secret_key),
        json={"Messages": [{
            "From": {"Email": settings.email_from, "Name": settings.email_from_name},
            "To": [{"Email": to}],
            "Subject": subject,
            "TextPart": text,
            "HTMLPart": html,
        }]},
    )
    status = ((resp.json().get("Messages") or [{}])[0]).get("Status")
    if status != "success":
        raise RuntimeError(f"Mailjet: {resp.text[:300]}")


async def _send_resend(to: str, subject: str, text: str, html: str) -> None:
    """Resend: відправник — адреса на домені, підтвердженому в Resend (без домену — лише onboarding@resend.dev)."""
    await _post(
        "https://api.resend.com/emails", "Resend",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": f"{settings.email_from_name} <{settings.email_from}>", "to": [to],
              "subject": subject, "text": text, "html": html},
    )


async def _send_brevo(to: str, subject: str, text: str, html: str) -> None:
    await _post(
        "https://api.brevo.com/v3/smtp/email", "Brevo",
        headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
        json={
            "sender": {"email": settings.email_from, "name": settings.email_from_name},
            "to": [{"email": to}],
            "subject": subject,
            "textContent": text,
            "htmlContent": html,
        },
    )


def _send_smtp(to: str, subject: str, text: str, html: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{settings.email_from_name} <{settings.email_from or settings.smtp_user}>"
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)


async def send_code_sms(phone: str, code: str) -> None:
    text = f"NeVpade: код підтвердження {code}"
    provider = settings.sms_provider

    if provider == "console":
        log.warning("[SMS → %s] %s", phone, text)
        return
    try:
        if provider == "turbosms":
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.turbosms.ua/message/send.json",
                    headers={"Authorization": f"Bearer {settings.turbosms_token}"},
                    json={"recipients": [phone.lstrip("+")], "sms": {"sender": settings.turbosms_sender, "text": text}},
                )
            data = resp.json()
            # Успіх, якщо отримувач прийнятий: у response_result є message_id
            results = data.get("response_result") or []
            if resp.status_code >= 300 or not any(r.get("message_id") for r in results if isinstance(r, dict)):
                raise RuntimeError(f"TurboSMS: {data}")
        else:
            raise RuntimeError(f"Невідомий SMS_PROVIDER: {provider}")
    except Exception as exc:  # noqa: BLE001
        log.exception("Не вдалося надіслати SMS на %s", phone)
        raise ApiError(502, "Не вдалося надіслати SMS. Спробуйте пізніше", "sms_failed") from exc
