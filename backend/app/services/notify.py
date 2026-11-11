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


def _html(title: str, code: str) -> str:
    return f"""
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px">NeVpade · {title}</h2>
  <p>Ваш код:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:8px 0">{code}</p>
  <p style="color:#6b7280">Код дійсний 10 хвилин. Якщо ви не робили цей запит — просто проігноруйте лист.</p>
</div>"""


async def send_code_email(to: str, code: str, purpose: str) -> None:
    subject, lead = _PURPOSE_TEXT.get(purpose, _PURPOSE_TEXT["verify"])
    text = f"{lead}: {code}\nКод дійсний 10 хвилин."
    provider = settings.email_provider

    if provider == "console":
        log.warning("[EMAIL → %s] %s: %s", to, subject, code)
        return
    try:
        if provider == "brevo":
            await _send_brevo(to, f"NeVpade · {subject}", text, _html(subject, code))
        elif provider == "smtp":
            await asyncio.to_thread(_send_smtp, to, f"NeVpade · {subject}", text, _html(subject, code))
        else:
            raise RuntimeError(f"Невідомий EMAIL_PROVIDER: {provider}")
    except Exception as exc:  # noqa: BLE001
        log.exception("Не вдалося надіслати лист на %s", to)
        raise ApiError(502, "Не вдалося надіслати лист. Спробуйте пізніше", "email_failed") from exc


async def _send_brevo(to: str, subject: str, text: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
            json={
                "sender": {"email": settings.email_from, "name": settings.email_from_name},
                "to": [{"email": to}],
                "subject": subject,
                "textContent": text,
                "htmlContent": html,
            },
        )
    if resp.status_code >= 300:
        raise RuntimeError(f"Brevo {resp.status_code}: {resp.text[:300]}")


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
