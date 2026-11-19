"""Розділ 1 контракту: реєстрація, підтвердження пошти й телефону, вхід менеджера й власника, Google.

Дві ролі: власник (owner) створює компанію й входить поштою + паролем + кодом власника;
менеджер (manager) приєднується за кодом запрошення й чекає, доки власник прийме заявку.
"""
from contextlib import suppress
from datetime import timedelta

from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import any_user, db, optional_user, owner_user
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
    OwnerCodeIn,
    OwnerCodeResetIn,
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
from ..services import codes, notify, owner_code, social
from ..services.users import (
    PHONE_SETUP_WINDOW,
    attach_company,
    auth_response,
    member_status,
    new_user_doc,
    open_join_request,
    release_phone_from_unverified,
    resolve_company_choice,
    user_out,
)
from ..utils import now

router = APIRouter(prefix="/auth", tags=["Авторизація"])

BAD_CREDENTIALS = ApiError(401, "Невірна пошта або пароль", "invalid_credentials")
OWNER_MAX_FAILS = 5
OWNER_LOCK = timedelta(minutes=15)
OWNER_CODE_RESET_COOLDOWN = timedelta(seconds=60)


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
    """Крок 2: код з SMS → вхід. Менеджеру — заявка власнику; новому власнику — код власника (один раз)."""
    user = await _phone_setup_user(database, body.email, token_user)
    if not user.get("phone"):
        raise ApiError(400, "Спершу вкажіть номер телефону", "phone_required")
    await codes.consume(database, user["email"], "verify_phone", body.code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"phoneVerified": True}, "$unset": {"phoneSetupUntil": ""}})
    user["phoneVerified"] = True

    new_code = None
    if user.get("role") == "owner" and not user.get("ownerCodeHash"):
        new_code = await owner_code.issue(database, user)
    elif user.get("companyId") is not None and member_status(user) == "pending":
        await open_join_request(database, user)
    return await auth_response(database, user, owner_code=new_code)


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
async def _owner_failed(database: AsyncDatabase, user: dict) -> None:
    """Невдала спроба входу власника: після 5 поспіль — пауза 15 хвилин для цієї пошти."""
    fails = int(user.get("ownerLoginFails") or 0) + 1
    update: dict = {"ownerLoginFails": fails}
    if fails >= OWNER_MAX_FAILS:
        update = {"ownerLoginFails": 0, "ownerLockUntil": now() + OWNER_LOCK}
    await database.users.update_one({"_id": user["_id"]}, {"$set": update})


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginIn, database: AsyncDatabase = Depends(db)):
    """Менеджер: пошта + пароль. Власник: пошта + пароль + код власника (другий фактор)."""
    user = await database.users.find_one({"email": body.email})
    is_owner_account = bool(user) and user.get("role") == "owner"
    if is_owner_account and user.get("ownerLockUntil") and user["ownerLockUntil"] > now():
        raise ApiError(429, "Забагато невдалих спроб. Спробуйте за 15 хвилин", "too_many_attempts")
    if user is None or not verify_password(body.password, user.get("passwordHash")):
        if is_owner_account:
            await _owner_failed(database, user)
        raise BAD_CREDENTIALS
    if not user.get("emailVerified"):
        with suppress(ApiError):  # заодно надсилаємо свіжий код, фронт перекине на сторінку його введення
            await _send_email_code(database, body.email, "verify")
        raise ApiError(403, "Пошту не підтверджено", "email_not_verified")

    if body.role == "manager" and is_owner_account:
        raise ApiError(403, "Це акаунт власника. Оберіть вгорі «Власник» і введіть код власника", "wrong_role")
    if body.role == "owner" and not is_owner_account:
        raise ApiError(403, "Це акаунт менеджера. Оберіть вгорі «Менеджер»", "wrong_role")
    if user.get("removedAt") and user.get("companyId") is None:
        raise ApiError(403, "Цей акаунт більше не має доступу до компанії. Зверніться до власника", "not_in_company")

    new_code = None
    if is_owner_account:
        if user.get("ownerCodeHash"):
            if not owner_code.matches(body.owner_code, user["ownerCodeHash"]):
                await _owner_failed(database, user)
                raise ApiError(401, "Невірний код власника", "invalid_owner_code")
            if user.get("ownerLoginFails"):
                await database.users.update_one({"_id": user["_id"]}, {"$unset": {"ownerLoginFails": ""}})
        else:
            # Власник, зареєстрований до появи кодів: видаємо код зараз і показуємо один раз
            new_code = await owner_code.issue(database, user)
    return await auth_response(database, user, owner_code=new_code)


@router.post("/owner-code/reset", response_model=Message)
async def reset_owner_code(body: OwnerCodeResetIn, database: AsyncDatabase = Depends(db)):
    """«Забули код власника?» — новий код листом на пошту власника. Відповідь однакова для будь-якої пошти."""
    user = await database.users.find_one({"email": body.email})
    sent_at = (user or {}).get("ownerCodeSentAt")
    if (user and user.get("role") == "owner" and user.get("emailVerified")
            and not (sent_at and now() - sent_at < OWNER_CODE_RESET_COOLDOWN)):
        code = await owner_code.issue(database, user)
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"ownerCodeSentAt": now()}})
        await notify.send_owner_code_email(user["email"], code)
    return Message(message="Якщо це акаунт власника, новий код надіслано на пошту")


@router.post("/owner-code")
async def new_owner_code(body: OwnerCodeIn, user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    """Новий код власника з кабінету (потрібен поточний пароль). { ownerCode } — показується один раз."""
    if not verify_password(body.password, user.get("passwordHash")):
        raise ApiError(400, "Невірний пароль", "wrong_password")
    return {"ownerCode": await owner_code.issue(database, user)}


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
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hash_password(body.password)}})
    return Message(message="Пароль змінено")


# ---------- Google (лише менеджери) ----------
@router.post("/google", response_model=AuthResponse)
async def google_login(body: GoogleIn, database: AsyncDatabase = Depends(db)):
    info = await social.verify_google(body.credential)
    user = await database.users.find_one({"googleId": info["sub"]}) or await database.users.find_one({"email": info["email"]})
    if user is not None and user.get("role") == "owner":
        raise ApiError(403, "Власник входить поштою, паролем і кодом власника — оберіть вгорі «Власник»", "wrong_role")

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
    company = await database.companies.find_one({"inviteCode": body.code.strip().upper()}, {"_id": 1})
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
