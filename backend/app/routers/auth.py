"""Розділ 1 контракту: реєстрація, підтвердження пошти й телефону, вхід менеджера й власника, Google.

Дві ролі: власник (owner) створює компанію й входить поштою + паролем;
менеджер (manager) приєднується за кодом компанії, чекає, доки власник прийме заявку,
і входить поштою + паролем + кодом компанії (змінив власник код — старий не діє).
"""
from contextlib import suppress
from datetime import timedelta

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import any_user, db, optional_user
from ..errors import ApiError
from ..schemas.auth import (
    AuthResponse,
    ChangePasswordIn,
    CompleteSignupIn,
    CompleteSignupOut,
    EmailCodeIn,
    ForgotIn,
    GoogleIn,
    JoinRequestIn,
    LoginIn,
    PhoneIn,
    PhoneOut,
    RegisterIn,
    RegisterOut,
    ResendIn,
    ResetIn,
    UserOut,
    VerifyEmailOut,
)
from ..schemas.common import Message
from ..security import hash_password, verify_password
from ..services import codes, notify, social
from ..services.users import (
    PHONE_SETUP_WINDOW,
    attach_company,
    auth_response,
    company_code_ok,
    member_status,
    normalize_company_code,
    new_user_doc,
    open_join_request,
    release_phone_from_unverified,
    resolve_company_choice,
    user_out,
)
from ..utils import now

router = APIRouter(prefix="/auth", tags=["Авторизація"])

BAD_CREDENTIALS = ApiError(401, "Невірна пошта або пароль", "invalid_credentials")
BAD_COMPANY_CODE = ApiError(401, "Невірний код компанії. Уточніть актуальний код у власника", "invalid_company_code")
LOGIN_MAX_FAILS = 5
LOGIN_LOCK = timedelta(minutes=15)


async def _send_email_code(database: AsyncDatabase, email: str, purpose: str, *, cooldown: bool = True) -> None:
    code = await codes.issue(database, email, purpose, enforce_cooldown=cooldown)
    await notify.send_code_email(email, code, purpose)


async def _send_phone_code(database: AsyncDatabase, user: dict, *, cooldown: bool = True) -> None:
    code = await codes.issue(database, user["email"], "verify_phone", enforce_cooldown=cooldown)
    await notify.send_code_sms(user["phone"], code)


async def _phone_setup_user(database: AsyncDatabase, email: str, token_user: dict | None = None) -> dict:
    """Користувач, який зараз має право прив'язати/підтвердити телефон.
    Якщо в запиті є дійсний токен — беремо користувача з нього (контракт), інакше за email у «вікні» після входу."""
    user = token_user or await database.users.find_one({"email": email})
    if user is None or not user.get("emailVerified"):
        raise ApiError(400, "Спершу підтвердіть пошту", "email_not_verified")
    if user.get("phoneVerified"):
        raise ApiError(400, "Телефон уже підтверджено. Увійдіть у систему", "phone_already_verified")
    if token_user is None:
        until = user.get("phoneSetupUntil")
        if until is None or until < now():
            raise ApiError(401, "Час на підтвердження телефону минув. Увійдіть знову", "phone_setup_expired")
    return user


# ---------- Реєстрація ----------
@router.post("/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, database: AsyncDatabase = Depends(db)):
    """Власник (role: owner) створює компанію, менеджер (role: manager) приєднується за кодом запрошення."""
    existing = await database.users.find_one({"email": body.email})
    if existing and existing.get("emailVerified"):
        raise ApiError(409, "Цей email уже зареєстровано. Увійдіть або відновіть пароль", "email_taken")

    if await release_phone_from_unverified(database, body.phone, except_id=existing["_id"] if existing else None):
        raise ApiError(409, "Цей номер уже використовується", "phone_taken")

    pending = await resolve_company_choice(database, body.company, body.name)

    fields = {"name": body.name, "phone": body.phone, "passwordHash": hash_password(body.password), "pendingCompany": pending}
    if existing:  # незавершена реєстрація з тим самим email — перезаписуємо дані
        await database.users.update_one({"_id": existing["_id"]}, {"$set": fields})
    else:
        try:
            await database.users.insert_one(new_user_doc(email=body.email, **fields))
        except DuplicateKeyError:
            raise ApiError(409, "Цей email або номер уже використовується", "email_taken") from None

    await _send_email_code(database, body.email, "verify", cooldown=False)
    return RegisterOut(email=body.email, message="Код підтвердження надіслано на пошту")


@router.post("/verify-email", response_model=VerifyEmailOut)
async def verify_email(body: EmailCodeIn, database: AsyncDatabase = Depends(db)):
    """Крок 1: код з пошти. Далі — SMS на телефон (токен ще не видається)."""
    user = await database.users.find_one({"email": body.email})
    if user is None:
        raise ApiError(400, "Термін дії коду минув. Запросіть новий код", "code_expired")
    if user.get("emailVerified"):
        raise ApiError(400, "Пошту вже підтверджено. Увійдіть у систему", "email_already_verified")

    await codes.consume(database, body.email, "verify", body.code)
    # Спершу компанія, потім позначка «пошту підтверджено»: якщо запит обірветься посередині,
    # користувач не лишиться «підтвердженим без компанії»
    if user.get("companyId") is None:
        await attach_company(database, user, user.get("pendingCompany"))
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"emailVerified": True, "phoneSetupUntil": now() + PHONE_SETUP_WINDOW}})
    user["emailVerified"] = True

    if user.get("phone"):
        await _send_phone_code(database, user, cooldown=False)
    return VerifyEmailOut(phone=user.get("phone"))


@router.post("/phone", response_model=PhoneOut)
async def add_phone(body: PhoneIn, database: AsyncDatabase = Depends(db), token_user: dict | None = Depends(optional_user)):
    """Додати/змінити номер (після входу через Google або на кроці підтвердження) → SMS з кодом."""
    user = await _phone_setup_user(database, body.email, token_user)
    if await release_phone_from_unverified(database, body.phone, except_id=user["_id"]):
        raise ApiError(409, "Цей номер уже використовується", "phone_taken")
    try:
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"phone": body.phone}})
    except DuplicateKeyError:
        raise ApiError(409, "Цей номер уже використовується", "phone_taken") from None
    user["phone"] = body.phone
    await _send_phone_code(database, user, cooldown=False)
    return PhoneOut(phone=body.phone, message="Код надіслано в SMS")


@router.post("/verify-phone", response_model=AuthResponse)
async def verify_phone(body: EmailCodeIn, database: AsyncDatabase = Depends(db),
                       token_user: dict | None = Depends(optional_user)):
    """Крок 2: код з SMS → вхід. Менеджеру — заявка власнику компанії."""
    user = await _phone_setup_user(database, body.email, token_user)
    if not user.get("phone"):
        raise ApiError(400, "Спершу вкажіть номер телефону", "phone_required")
    await codes.consume(database, user["email"], "verify_phone", body.code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"phoneVerified": True}, "$unset": {"phoneSetupUntil": ""}})
    user["phoneVerified"] = True

    if user.get("companyId") is not None and member_status(user) == "pending":
        await open_join_request(database, user)
    return await auth_response(database, user)


@router.post("/resend-code", response_model=Message)
async def resend_code(body: ResendIn, database: AsyncDatabase = Depends(db), token_user: dict | None = Depends(optional_user)):
    user = await database.users.find_one({"email": body.email})
    if body.purpose == "verify":
        if user and not user.get("emailVerified"):
            await _send_email_code(database, body.email, "verify")
    elif body.purpose == "reset":
        if user and user.get("emailVerified"):
            await _send_email_code(database, body.email, "reset")
    else:  # verify_phone
        user = await _phone_setup_user(database, body.email, token_user)
        if not user.get("phone"):
            raise ApiError(400, "Спершу вкажіть номер телефону", "phone_required")
        await _send_phone_code(database, user)
    return Message(message="Код надіслано повторно")


# ---------- Вхід ----------
def _check_lock(user: dict | None) -> None:
    if user and user.get("loginLockUntil") and user["loginLockUntil"] > now():
        raise ApiError(429, "Забагато невдалих спроб. Вхід призупинено на 15 хвилин", "too_many_attempts")


async def _login_failed(database: AsyncDatabase, user: dict, error: ApiError) -> ApiError:
    """Невдала спроба (пароль чи код компанії): після 5 поспіль — пауза 15 хвилин для цієї пошти."""
    fails = int(user.get("loginFails") or 0) + 1
    update: dict = {"loginFails": fails}
    if fails >= LOGIN_MAX_FAILS:
        update = {"loginFails": 0, "loginLockUntil": now() + LOGIN_LOCK}
    await database.users.update_one({"_id": user["_id"]}, {"$set": update})
    return error


async def _login_ok(database: AsyncDatabase, user: dict) -> None:
    if user.get("loginFails") or user.get("loginLockUntil"):
        await database.users.update_one({"_id": user["_id"]}, {"$unset": {"loginFails": "", "loginLockUntil": ""}})


def _needs_company_code(user: dict) -> bool:
    """Код компанії потрібен менеджеру, який уже завершив реєстрацію (є компанія й підтверджений телефон)."""
    return user.get("role") != "owner" and user.get("companyId") is not None and bool(user.get("phoneVerified"))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginIn, database: AsyncDatabase = Depends(db)):
    """Менеджер: пошта + пароль + код компанії. Власник: пошта + пароль."""
    user = await database.users.find_one({"email": body.email})
    _check_lock(user)
    is_owner_account = bool(user) and user.get("role") == "owner"
    if user is not None and user.get("emailVerified") and not user.get("passwordHash") and not is_owner_account \
            and body.role != "owner":
        raise ApiError(401, "Цей акаунт входить через Google — введіть код компанії й натисніть «Продовжити з Google»",
                       "use_google")
    if user is None or not verify_password(body.password, user.get("passwordHash")):
        raise await _login_failed(database, user, BAD_CREDENTIALS) if user else BAD_CREDENTIALS
    if not user.get("emailVerified"):
        with suppress(ApiError):  # заодно надсилаємо свіжий код, фронт перекине на сторінку його введення
            await _send_email_code(database, body.email, "verify")
        raise ApiError(403, "Пошту не підтверджено", "email_not_verified")

    if body.role == "manager" and is_owner_account:
        raise ApiError(403, "Це акаунт власника. Оберіть вгорі «Власник»", "wrong_role")
    if body.role == "owner" and not is_owner_account:
        raise ApiError(403, "Це акаунт менеджера. Оберіть вгорі «Менеджер» і введіть код компанії", "wrong_role")
    if user.get("removedAt") and user.get("companyId") is None:
        raise ApiError(403, "Цей акаунт більше не має доступу до компанії. Зверніться до власника", "not_in_company")
    if _needs_company_code(user) and not await company_code_ok(database, user, body.company_code):
        raise await _login_failed(database, user, BAD_COMPANY_CODE)

    await _login_ok(database, user)
    return await auth_response(database, user)


@router.post("/forgot-password", response_model=Message)
async def forgot_password(body: ForgotIn, database: AsyncDatabase = Depends(db)):
    user = await database.users.find_one({"email": body.email})
    if user and user.get("emailVerified"):
        try:
            await _send_email_code(database, body.email, "reset")
        except ApiError as exc:
            if exc.status != 429:
                raise
    # Однакова відповідь для будь-якого email — щоб не розкривати, хто зареєстрований
    return Message(message="Якщо такий email зареєстровано, на нього надіслано код")


@router.post("/reset-password", response_model=Message)
async def reset_password(body: ResetIn, database: AsyncDatabase = Depends(db)):
    user = await database.users.find_one({"email": body.email})
    if user is None or not user.get("emailVerified"):
        raise ApiError(400, "Термін дії коду минув. Запросіть новий код", "code_expired")
    await codes.consume(database, body.email, "reset", body.code)
    # Новий пароль знімає й блокування входу після невдалих спроб
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hash_password(body.password)},
                                                          "$unset": {"loginFails": "", "loginLockUntil": ""}})
    return Message(message="Пароль змінено")


# ---------- Google (лише менеджери) ----------
@router.post("/google", response_model=AuthResponse)
async def google_login(body: GoogleIn, database: AsyncDatabase = Depends(db)):
    info = await social.verify_google(body.credential)
    user = await database.users.find_one({"googleId": info["sub"]}) or await database.users.find_one({"email": info["email"]})
    if user is not None and user.get("role") == "owner":
        raise ApiError(403, "Власник входить поштою й паролем — оберіть вгорі «Власник»", "wrong_role")
    if user is not None and user.get("emailVerified"):
        _check_lock(user)
        if user.get("removedAt") and user.get("companyId") is None:
            raise ApiError(403, "Цей акаунт більше не має доступу до компанії. Зверніться до власника", "not_in_company")
        # Наявний менеджер — як і при вході паролем, лише з актуальним кодом компанії
        if _needs_company_code(user):
            if not await company_code_ok(database, user, body.company_code):
                raise await _login_failed(database, user, BAD_COMPANY_CODE)
            await _login_ok(database, user)

    is_new = False
    if user is None:
        # Новий: пошту підтвердив Google; ім'я, код запрошення й телефон людина вкаже на кроці
        # «Завершіть реєстрацію» (POST /auth/complete-signup)
        doc = new_user_doc(name=info["name"], email=info["email"], emailVerified=True, avatarUrl=info.get("picture"),
                           role=None, googleId=info["sub"])
        try:
            result = await database.users.insert_one(doc)
        except DuplicateKeyError:  # паралельний запит уже створив користувача
            user = await database.users.find_one({"email": info["email"]})
        else:
            doc["_id"] = result.inserted_id
            user, is_new = doc, True
    else:
        update: dict = {"googleId": info["sub"]}
        if not user.get("emailVerified"):
            # Хтось почав реєстрацію з цим email, але не підтвердив його. Google довів, що пошта
            # належить цьому користувачу, тож чужий пароль/номер/вибір компанії скидаємо.
            update.update(emailVerified=True, passwordHash=None, phone=None, phoneVerified=False)
            user.pop("pendingCompany", None)
            await database.users.update_one({"_id": user["_id"]}, {"$unset": {"pendingCompany": ""}})
        if info.get("picture") and not user.get("avatarUrl"):
            update["avatarUrl"] = info["picture"]
        await database.users.update_one({"_id": user["_id"]}, {"$set": update})
        user.update(update)
    return await auth_response(database, user, is_new=is_new)


@router.post("/complete-signup", response_model=CompleteSignupOut)
async def complete_signup(body: CompleteSignupIn, user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    """«Завершіть реєстрацію» після Google: ім'я, код запрошення й телефон → SMS → /auth/verify-phone → заявка власнику."""
    if user.get("companyId") is not None:
        raise ApiError(409, "Реєстрацію вже завершено", "already_completed")
    if body.company.mode != "join":
        raise ApiError(400, "Власник реєструється поштою й паролем — через Google можна приєднатися лише менеджером",
                       "owner_needs_password")
    if await release_phone_from_unverified(database, body.phone, except_id=user["_id"]):
        raise ApiError(409, "Цей номер уже використовується", "phone_taken")
    choice = await resolve_company_choice(database, body.company, body.name)
    try:
        await database.users.update_one({"_id": user["_id"]}, {"$set": {
            "name": body.name, "phone": body.phone, "phoneVerified": False, "phoneSetupUntil": now() + PHONE_SETUP_WINDOW,
        }})
    except DuplicateKeyError:
        raise ApiError(409, "Цей номер уже використовується", "phone_taken") from None
    user.update(name=body.name, phone=body.phone, phoneVerified=False)
    await attach_company(database, user, choice)
    await _send_phone_code(database, user, cooldown=False)
    return CompleteSignupOut(user=await user_out(database, user), message="Код надіслано в SMS")


@router.post("/join-request")
async def join_request(body: JoinRequestIn, user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    """Нова заявка на вступ — для менеджера, якого відхилили або прибрали з компанії. { user } з memberStatus: pending."""
    if user.get("role") == "owner":
        raise ApiError(403, "Власник не подає заявок — він передає компанію", "manager_only")
    if not user.get("phoneVerified"):
        raise ApiError(403, "Спершу підтвердьте номер телефону", "signup_incomplete")
    company = await database.companies.find_one({"inviteCode": normalize_company_code(body.code)}, {"_id": 1})
    if company is None:
        raise ApiError(404, "Компанію з таким кодом не знайдено. Перевірте код у власника", "company_not_found")
    if company["_id"] == user.get("companyId") and member_status(user) in ("pending", "active"):
        raise ApiError(409, "Ви вже в цій компанії або заявку вже надіслано", "same_company")
    await attach_company(database, user, {"mode": "join", "companyId": company["_id"]})
    await open_join_request(database, user)
    return {"user": await user_out(database, user)}


# ---------- Поточний користувач ----------
@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    """Актуальні роль, компанія й статус з бази — фронт викликає на кожній внутрішній сторінці."""
    return await user_out(database, user)


@router.post("/change-password", response_model=Message)
async def change_password(body: ChangePasswordIn, user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    # Користувач, що входив лише через Google, пароля не має — дозволяємо задати його без поточного
    if user.get("passwordHash") and not verify_password(body.current_password, user["passwordHash"]):
        raise ApiError(400, "Невірний поточний пароль", "invalid_password")
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hash_password(body.new_password)}})
    return Message(message="Пароль змінено")
