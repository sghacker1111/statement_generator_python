from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import hmac
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4


ADMIN_USERNAME = "sgstatement"
ADMIN_PASSWORD = "SG@hacker@19909"
PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 200_000
DEFAULT_DEVICE_LIMIT = 2
ACCESS_MODES = {"limited", "monthly", "yearly", "time", "check_only", "unlimited"}
MAX_SAVED_STATEMENTS = 50


def _utcnow_text() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PASSWORD_ITERATIONS).hex()
    return f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}${salt}${digest}"


def verify_password_hash(password: str, encoded: str) -> bool:
    try:
        scheme, iterations_text, salt, stored_digest = encoded.split("$", 3)
        iterations = int(iterations_text)
    except ValueError:
        return False
    if scheme != PASSWORD_SCHEME:
        return False
    calculated = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations).hex()
    return hmac.compare_digest(calculated, stored_digest)


@dataclass(slots=True)
class AuthUser:
    id: int
    username: str
    role: str
    created_at: str
    access_mode: str = "unlimited"
    remaining_statements: int | None = None
    valid_until: str = ""
    device_limit: int = DEFAULT_DEVICE_LIMIT
    active_device_count: int = 0
    generated_statement_count: int = 0
    full_name: str = ""
    address: str = ""
    mobile_number: str = ""
    email: str = ""
    gender: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"

    @property
    def can_manage_users(self) -> bool:
        return self.is_admin

    @property
    def can_use_statements(self) -> bool:
        return not self.is_admin

    def as_payload(self) -> dict[str, object]:
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "is_admin": self.is_admin,
            "is_super_admin": self.is_super_admin,
            "can_manage_users": self.can_manage_users,
            "can_use_statements": self.can_use_statements,
            "created_at": self.created_at,
            "access_mode": self.access_mode,
            "remaining_statements": self.remaining_statements,
            "valid_until": self.valid_until,
            "device_limit": self.device_limit,
            "active_device_count": self.active_device_count,
            "generated_statement_count": self.generated_statement_count,
            "full_name": self.full_name,
            "address": self.address,
            "mobile_number": self.mobile_number,
            "email": self.email,
            "gender": self.gender,
        }


class AuthStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self._lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS statements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    customer_name TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    issue_date TEXT NOT NULL,
                    final_balance REAL NOT NULL,
                    row_count INTEGER NOT NULL,
                    seed INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """
            )
            self._ensure_column(connection, "users", "access_mode", "TEXT NOT NULL DEFAULT 'unlimited'")
            self._ensure_column(connection, "users", "remaining_statements", "INTEGER")
            self._ensure_column(connection, "users", "valid_until", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "users", "saved_profile_json", "TEXT")
            self._ensure_column(connection, "users", "saved_profile_formats_json", "TEXT")
            self._ensure_column(connection, "users", "device_limit", f"INTEGER NOT NULL DEFAULT {DEFAULT_DEVICE_LIMIT}")
            self._ensure_column(connection, "users", "generated_statement_count", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "users", "full_name", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "users", "address", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "users", "mobile_number", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "users", "email", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "users", "gender", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "auth_tokens", "device_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "statements", "updated_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "statements", "source_type", "TEXT NOT NULL DEFAULT 'generated'")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    device_id TEXT NOT NULL,
                    device_label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT NOT NULL,
                    UNIQUE(user_id, device_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_activities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT NOT NULL DEFAULT '',
                    action_name TEXT NOT NULL,
                    details_text TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )

            admin_row = connection.execute(
                "SELECT id, password_hash, role FROM users WHERE username = ?",
                (ADMIN_USERNAME,),
            ).fetchone()
            if admin_row is None:
                connection.execute(
                    """
                    INSERT INTO users (
                        username, password_hash, role, created_at, access_mode,
                        remaining_statements, valid_until, saved_profile_json, saved_profile_formats_json, device_limit,
                        full_name, address, mobile_number, email, gender
                    )
                    VALUES (?, ?, 'admin', ?, 'unlimited', NULL, '', '', '', ?, 'SGHACKER WEB TOOL', '', '', '', '')
                    """,
                    (
                        ADMIN_USERNAME,
                        hash_password(ADMIN_PASSWORD),
                        _utcnow_text(),
                        DEFAULT_DEVICE_LIMIT,
                    ),
                )
            elif not verify_password_hash(ADMIN_PASSWORD, str(admin_row["password_hash"])) or str(admin_row["role"]) != "admin":
                connection.execute(
                    """
                    UPDATE users
                    SET password_hash = ?, role = 'admin', access_mode = 'unlimited', saved_profile_formats_json = COALESCE(saved_profile_formats_json, ''), device_limit = ?, full_name = COALESCE(NULLIF(full_name, ''), 'SGHACKER WEB TOOL')
                    WHERE id = ?
                    """,
                    (hash_password(ADMIN_PASSWORD), DEFAULT_DEVICE_LIMIT, int(admin_row["id"])),
                )
            connection.commit()

    def _ensure_column(self, connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {str(row["name"]) for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _row_to_user(self, row: sqlite3.Row | None) -> AuthUser | None:
        if row is None:
            return None
        access_mode = str(row["access_mode"]) if "access_mode" in row.keys() else "unlimited"
        if access_mode not in ACCESS_MODES:
            access_mode = "unlimited"
        remaining = row["remaining_statements"] if "remaining_statements" in row.keys() else None
        remaining_value = None if remaining is None or access_mode not in {"limited", "monthly", "yearly"} else max(0, int(remaining))
        valid_until = str(row["valid_until"]) if "valid_until" in row.keys() and access_mode in {"time", "monthly", "yearly"} else ""
        active_device_count = int(row["active_device_count"]) if "active_device_count" in row.keys() else 0
        device_limit = int(row["device_limit"]) if "device_limit" in row.keys() and row["device_limit"] else DEFAULT_DEVICE_LIMIT
        generated_statement_count = int(row["generated_statement_count"]) if "generated_statement_count" in row.keys() and row["generated_statement_count"] is not None else 0
        return AuthUser(
            id=int(row["id"]),
            username=str(row["username"]),
            role=str(row["role"]),
            created_at=str(row["created_at"]),
            access_mode=access_mode,
            remaining_statements=remaining_value,
            valid_until=valid_until,
            device_limit=max(1, device_limit),
            active_device_count=active_device_count,
            generated_statement_count=max(0, generated_statement_count),
            full_name=str(row["full_name"]) if "full_name" in row.keys() else "",
            address=str(row["address"]) if "address" in row.keys() else "",
            mobile_number=str(row["mobile_number"]) if "mobile_number" in row.keys() else "",
            email=str(row["email"]) if "email" in row.keys() else "",
            gender=str(row["gender"]) if "gender" in row.keys() else "",
        )

    def _normalize_device_id(self, device_id: str) -> str:
        filtered = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in device_id.strip())
        return filtered[:120]

    def _normalize_device_label(self, device_label: str) -> str:
        normalized = " ".join(device_label.split()).strip()
        return (normalized or "Web Browser")[:255]

    def _validated_access_values(
        self,
        access_mode: str,
        remaining_statements: int | None,
        valid_until: str,
    ) -> tuple[str, int | None, str]:
        normalized_mode = access_mode.strip().lower() or "unlimited"
        if normalized_mode not in ACCESS_MODES:
            raise ValueError("Access type must be limited, monthly, yearly, time based, statement check, or unlimited.")
        normalized_valid_until = valid_until.strip()
        normalized_remaining = remaining_statements
        if normalized_mode in {"limited", "monthly", "yearly"}:
            if normalized_remaining is None or normalized_remaining < 0:
                raise ValueError("Enter how many statements this user can generate.")
            normalized_remaining = int(normalized_remaining)
            if normalized_mode == "limited":
                normalized_valid_until = ""
        elif normalized_mode == "time":
            if not normalized_valid_until:
                raise ValueError("Enter the valid-until date for a time-based user.")
            try:
                normalized_valid_until = date.fromisoformat(normalized_valid_until).isoformat()
            except ValueError as error:
                raise ValueError("Enter a valid expiration date for the time-based user.") from error
            normalized_remaining = None
        elif normalized_mode == "check_only":
            normalized_remaining = None
            normalized_valid_until = ""
        else:
            normalized_remaining = None
            normalized_valid_until = ""
        if normalized_mode in {"monthly", "yearly"}:
            if not normalized_valid_until:
                raise ValueError("Enter the valid-until date for monthly or yearly access.")
            try:
                normalized_valid_until = date.fromisoformat(normalized_valid_until).isoformat()
            except ValueError as error:
                raise ValueError("Enter a valid expiration date for monthly or yearly access.") from error
        return normalized_mode, normalized_remaining, normalized_valid_until

    def _ensure_statement_allowed(self, user: AuthUser) -> None:
        if user.is_admin:
            raise PermissionError("Admin accounts can manage users only. Use a Super Admin or User account for statement work.")
        if user.is_super_admin:
            return
        if user.access_mode == "check_only":
            raise PermissionError("This user can only import and check statements. Please contact the admin for generation access.")
        if user.access_mode in {"limited", "monthly", "yearly"}:
            if (user.remaining_statements or 0) <= 0:
                raise PermissionError("Your statement creation limit is finished. Please contact the admin.")
            if user.access_mode == "limited":
                return
        if user.access_mode in {"time", "monthly", "yearly"}:
            if not user.valid_until:
                raise PermissionError("This user account does not have a valid statement period. Please contact the admin.")
            if date.today() > date.fromisoformat(user.valid_until):
                raise PermissionError("Your statement creation period has expired. Please contact the admin.")

    def _consume_statement_allowance(self, connection: sqlite3.Connection, user_id: int) -> None:
        row = connection.execute(
            "SELECT access_mode, remaining_statements FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None or str(row["access_mode"]) not in {"limited", "monthly", "yearly"}:
            return
        remaining = 0 if row["remaining_statements"] is None else max(0, int(row["remaining_statements"]))
        connection.execute(
            "UPDATE users SET remaining_statements = ? WHERE id = ?",
            (max(0, remaining - 1), user_id),
        )

    def _register_device_or_throw(self, connection: sqlite3.Connection, user_row: sqlite3.Row, device_id: str, device_label: str) -> None:
        existing = connection.execute(
            "SELECT id FROM devices WHERE user_id = ? AND device_id = ?",
            (int(user_row["id"]), device_id),
        ).fetchone()
        if existing is not None:
            connection.execute(
                "UPDATE devices SET device_label = ?, last_login_at = ? WHERE user_id = ? AND device_id = ?",
                (device_label, _utcnow_text(), int(user_row["id"]), device_id),
            )
            return
        count_row = connection.execute(
            "SELECT COUNT(*) AS device_count FROM devices WHERE user_id = ?",
            (int(user_row["id"]),),
        ).fetchone()
        device_count = int(count_row["device_count"]) if count_row is not None else 0
        if str(user_row["role"]) in {"admin", "super_admin"}:
            device_limit = 10**9
        else:
            device_limit = max(1, int(user_row["device_limit"] or DEFAULT_DEVICE_LIMIT))
        if device_count >= device_limit:
            raise PermissionError("This account is already using the maximum 2 devices. Ask the admin to remove an old device serial first.")
        timestamp = _utcnow_text()
        connection.execute(
            """
            INSERT INTO devices (user_id, device_id, device_label, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (int(user_row["id"]), device_id, device_label, timestamp, timestamp),
        )

    def login(self, username: str, password: str, device_id: str = "", device_label: str = "") -> dict[str, object]:
        normalized = username.strip()
        if not normalized or not password:
            raise ValueError("Enter username and password.")
        device_id = self._normalize_device_id(device_id)
        device_label = self._normalize_device_label(device_label)
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.username, users.password_hash, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender
                FROM users
                WHERE username = ?
                """,
                (normalized,),
            ).fetchone()
            if row is None or not verify_password_hash(password, str(row["password_hash"])):
                raise ValueError("Invalid username or password.")
            self._register_device_or_throw(connection, row, device_id, device_label)
            token = uuid4().hex
            connection.execute(
                "INSERT INTO auth_tokens (token, user_id, device_id, created_at) VALUES (?, ?, ?, ?)",
                (token, int(row["id"]), device_id, _utcnow_text()),
            )
            connection.commit()
            user = self._row_to_user(
                connection.execute(
                    """
                    SELECT users.id, users.username, users.role, users.created_at,
                           users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                           users.full_name, users.address, users.mobile_number, users.email, users.gender,
                           COUNT(devices.id) AS active_device_count
                    FROM users
                    LEFT JOIN devices ON devices.user_id = users.id
                    WHERE users.id = ?
                    GROUP BY users.id
                    """,
                    (int(row["id"]),),
                ).fetchone()
            )
        if user is None:
            raise ValueError("Unable to start the user session.")
        return {"token": token, "user": user}

    def logout(self, token: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM auth_tokens WHERE token = ?", (token.strip(),))
            connection.commit()

    def user_for_token(self, token: str) -> AuthUser | None:
        token = token.strip()
        if not token:
            return None
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender,
                       COUNT(devices.id) AS active_device_count
                FROM auth_tokens
                JOIN users ON users.id = auth_tokens.user_id
                LEFT JOIN devices ON devices.user_id = users.id
                WHERE auth_tokens.token = ?
                GROUP BY users.id
                """,
                (token,),
            ).fetchone()
        return self._row_to_user(row)

    def require_user(self, token: str) -> AuthUser:
        user = self.user_for_token(token)
        if user is None:
            raise PermissionError("Please log in first.")
        return user

    def require_admin(self, token: str) -> AuthUser:
        user = self.require_user(token)
        if not user.is_admin:
            raise PermissionError("Only the admin account can perform this action.")
        return user

    def require_statement_user(self, token: str) -> AuthUser:
        user = self.require_user(token)
        if not user.can_use_statements:
            raise PermissionError("Admin accounts can manage users only. Use a Super Admin or User account for statement work.")
        return user

    def verify_user_password(self, user_id: int, password: str) -> bool:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            return False
        return verify_password_hash(password, str(row["password_hash"]))

    def create_user(
        self,
        username: str,
        password: str,
        role: str,
        access_mode: str = "unlimited",
        remaining_statements: int | None = None,
        valid_until: str = "",
        full_name: str = "",
        address: str = "",
        mobile_number: str = "",
        email: str = "",
        gender: str = "",
    ) -> AuthUser:
        normalized_username = username.strip()
        normalized_role = role.strip().lower() or "user"
        if normalized_role in {"superadmin", "super-admin"}:
            normalized_role = "super_admin"
        if normalized_role not in {"admin", "super_admin", "user"}:
            raise ValueError("Role must be admin, super admin, or user.")
        if normalized_role == "super_admin":
            access_mode = "unlimited"
            remaining_statements = None
            valid_until = ""
        if len(normalized_username) < 3:
            raise ValueError("Username must be at least 3 characters.")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters.")
        normalized_full_name = " ".join(full_name.split()).strip()
        normalized_mobile_number = " ".join(mobile_number.split()).strip()
        if not normalized_full_name:
            raise ValueError("Name is required.")
        if not normalized_mobile_number:
            raise ValueError("Mobile number is required.")
        access_mode_value, remaining_value, valid_until_value = self._validated_access_values(
            access_mode,
            remaining_statements,
            valid_until,
        )
        created_at = _utcnow_text()
        with self._lock, self._connect() as connection:
            try:
                cursor = connection.execute(
                    """
                    INSERT INTO users (
                        username, password_hash, role, created_at,
                        access_mode, remaining_statements, valid_until, saved_profile_json, saved_profile_formats_json, device_limit,
                        full_name, address, mobile_number, email, gender
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        normalized_username,
                        hash_password(password),
                        normalized_role,
                        created_at,
                        access_mode_value,
                        remaining_value,
                        valid_until_value,
                        DEFAULT_DEVICE_LIMIT,
                        normalized_full_name,
                        address.strip(),
                        normalized_mobile_number,
                        email.strip(),
                        gender.strip(),
                    ),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError("That username already exists.") from error
            connection.commit()
            row = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender,
                       COUNT(devices.id) AS active_device_count
                FROM users
                LEFT JOIN devices ON devices.user_id = users.id
                WHERE users.id = ?
                GROUP BY users.id
                """,
                (int(cursor.lastrowid),),
            ).fetchone()
        user = self._row_to_user(row)
        if user is None:
            raise ValueError("Could not create the user.")
        return user

    def update_user_password(self, target_user_id: int, new_password: str) -> AuthUser:
        if len(new_password) < 6:
            raise ValueError("New password must be at least 6 characters.")
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender
                FROM users
                WHERE id = ?
                """,
                (target_user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Select a valid user first.")
            if str(row["username"]) == ADMIN_USERNAME:
                raise ValueError("The main admin password is locked in this web app package.")
            connection.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(new_password), target_user_id),
            )
            connection.execute("DELETE FROM auth_tokens WHERE user_id = ?", (target_user_id,))
            connection.commit()
        user = self._row_to_user(row)
        if user is None:
            raise ValueError("Could not update the user password.")
        return user

    def update_user_access(
        self,
        target_user_id: int,
        access_mode: str,
        remaining_statements: int | None,
        valid_until: str,
    ) -> AuthUser:
        access_mode_value, remaining_value, valid_until_value = self._validated_access_values(
            access_mode,
            remaining_statements,
            valid_until,
        )
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender
                FROM users
                WHERE id = ?
                """,
                (target_user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Select a valid user first.")
            connection.execute(
                "UPDATE users SET access_mode = ?, remaining_statements = ?, valid_until = ? WHERE id = ?",
                (access_mode_value, remaining_value, valid_until_value, target_user_id),
            )
            connection.commit()
            refreshed = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender,
                       COUNT(devices.id) AS active_device_count
                FROM users
                LEFT JOIN devices ON devices.user_id = users.id
                WHERE users.id = ?
                GROUP BY users.id
                """,
                (target_user_id,),
            ).fetchone()
        user = self._row_to_user(refreshed)
        if user is None:
            raise ValueError("Could not update the user access.")
        return user

    def delete_user(self, target_user_id: int, acting_user_id: int) -> AuthUser:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender
                FROM users
                WHERE id = ?
                """,
                (target_user_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Select a valid user first.")
            if str(row["username"]) == ADMIN_USERNAME:
                raise ValueError("The main admin account cannot be deleted.")
            if int(row["id"]) == acting_user_id:
                raise ValueError("You cannot delete the account you are currently using.")
            connection.execute("DELETE FROM auth_tokens WHERE user_id = ?", (target_user_id,))
            connection.execute("DELETE FROM devices WHERE user_id = ?", (target_user_id,))
            connection.execute("DELETE FROM statements WHERE user_id = ?", (target_user_id,))
            connection.execute("DELETE FROM user_activities WHERE user_id = ?", (target_user_id,))
            connection.execute("DELETE FROM users WHERE id = ?", (target_user_id,))
            connection.commit()
        user = self._row_to_user(row)
        if user is None:
            raise ValueError("Could not delete the user.")
        return user

    def list_users(self) -> list[dict[str, object]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender,
                       COUNT(devices.id) AS active_device_count
                FROM users
                LEFT JOIN devices ON devices.user_id = users.id
                GROUP BY users.id
                ORDER BY users.username COLLATE NOCASE
                """
            ).fetchall()
        payload_rows: list[dict[str, object]] = []
        for row in rows:
            user = self._row_to_user(row)
            if user is not None:
                payload_rows.append(user.as_payload())
        return payload_rows

    def save_profile(self, user: AuthUser, profile_payload: dict[str, object]) -> dict[str, object]:
        sanitized: dict[str, str] = {}
        for key, value in profile_payload.items():
            if not isinstance(key, str) or not key.strip():
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                sanitized[key] = str(value) if value is not None else ""
        encoded = json.dumps(sanitized, ensure_ascii=True)
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE users SET saved_profile_json = ? WHERE id = ?",
                (encoded, user.id),
            )
            connection.commit()
        return {"saved": True, "profile": sanitized}

    def load_profile(self, user: AuthUser) -> dict[str, object]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT saved_profile_json FROM users WHERE id = ?",
                (user.id,),
            ).fetchone()
        raw = "" if row is None else str(row["saved_profile_json"] or "")
        if not raw.strip():
            return {"profile": {}}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
        return {"profile": payload if isinstance(payload, dict) else {}}

    def _sanitize_profile_payload(self, profile_payload: dict[str, object]) -> dict[str, str]:
        sanitized: dict[str, str] = {}
        for key, value in profile_payload.items():
            if not isinstance(key, str) or not key.strip():
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                sanitized[key] = str(value) if value is not None else ""
        return sanitized

    def _profile_formats_map(self, user_id: int) -> dict[str, dict[str, str]]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT saved_profile_formats_json FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        raw = "" if row is None else str(row["saved_profile_formats_json"] or "")
        if not raw.strip():
            return {}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        cleaned: dict[str, dict[str, str]] = {}
        if not isinstance(payload, dict):
            return cleaned
        for name, data in payload.items():
            normalized_name = " ".join(str(name).split()).strip()
            if not normalized_name or not isinstance(data, dict):
                continue
            cleaned[normalized_name] = self._sanitize_profile_payload(data)
        return cleaned

    def save_profile_format(
        self,
        user: AuthUser,
        name: str,
        profile_payload: dict[str, object],
        original_name: str | None = None,
    ) -> dict[str, object]:
        normalized_name = " ".join(name.split()).strip()
        if not normalized_name:
            raise ValueError("Enter a format profile name first.")
        formats = self._profile_formats_map(user.id)
        normalized_original = " ".join(str(original_name or "").split()).strip()
        original_key = ""
        if normalized_original:
            for saved_name in formats:
                if saved_name.lower() == normalized_original.lower():
                    original_key = saved_name
                    break
            if not original_key:
                raise ValueError("Saved profile format was not found.")

        target_key = ""
        for saved_name in formats:
            if saved_name.lower() == normalized_name.lower():
                target_key = saved_name
                break
        if original_key and target_key and target_key != original_key:
            raise ValueError("Another profile format is already using that name.")
        if original_key and original_key != normalized_name and original_key in formats:
            formats.pop(original_key, None)
        formats[normalized_name] = self._sanitize_profile_payload(profile_payload)
        encoded = json.dumps(dict(sorted(formats.items(), key=lambda item: item[0].lower())), ensure_ascii=True)
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE users SET saved_profile_formats_json = ? WHERE id = ?",
                (encoded, user.id),
            )
            connection.commit()
        return {
            "saved": True,
            "profile_name": normalized_name,
            "name": normalized_name,
            "formats": [{"name": value} for value in sorted(formats.keys(), key=str.lower)],
            "profile": formats[normalized_name],
        }

    def delete_profile_format(self, user: AuthUser, name: str) -> dict[str, object]:
        normalized_name = " ".join(name.split()).strip()
        if not normalized_name:
            raise ValueError("Select a saved profile format first.")
        formats = self._profile_formats_map(user.id)
        matched_name = ""
        for saved_name in formats:
            if saved_name.lower() == normalized_name.lower():
                matched_name = saved_name
                break
        if not matched_name:
            raise ValueError("Saved profile format was not found.")
        formats.pop(matched_name, None)
        encoded = json.dumps(dict(sorted(formats.items(), key=lambda item: item[0].lower())), ensure_ascii=True)
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE users SET saved_profile_formats_json = ? WHERE id = ?",
                (encoded, user.id),
            )
            connection.commit()
        return {
            "deleted": True,
            "name": matched_name,
            "formats": [{"name": value} for value in sorted(formats.keys(), key=str.lower)],
        }

    def load_profile_format(self, user: AuthUser, name: str) -> dict[str, object]:
        normalized_name = " ".join(name.split()).strip()
        if not normalized_name:
            raise ValueError("Select a saved profile format first.")
        formats = self._profile_formats_map(user.id)
        for profile_name, payload in formats.items():
            if profile_name.lower() == normalized_name.lower():
                return {"profile_name": profile_name, "name": profile_name, "profile": payload}
        raise ValueError("Saved profile format was not found.")

    def list_profile_formats(self, user: AuthUser) -> dict[str, object]:
        formats = self._profile_formats_map(user.id)
        return {"formats": [{"name": value} for value in sorted(formats.keys(), key=str.lower)]}

    def _prune_saved_statements(self, connection: sqlite3.Connection, user_id: int) -> None:
        connection.execute(
            """
            DELETE FROM statements
            WHERE user_id = ?
              AND id NOT IN (
                SELECT id
                FROM statements
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?
              )
            """,
            (user_id, user_id, MAX_SAVED_STATEMENTS),
        )

    def _increment_generated_statement_count(self, connection: sqlite3.Connection, user_id: int) -> None:
        connection.execute(
            """
            UPDATE users
            SET generated_statement_count = COALESCE(generated_statement_count, 0) + 1
            WHERE id = ?
            """,
            (user_id,),
        )

    def record_statement(
        self,
        user: AuthUser,
        result_payload: dict[str, object],
        config_payload: dict[str, object],
    ) -> int:
        return int(self.save_statement(user, result_payload, config_payload)["statement_id"])

    def save_statement(
        self,
        user: AuthUser,
        result_payload: dict[str, object],
        config_payload: dict[str, object],
        statement_id: int | None = None,
        source_type: str = "generated",
        consume_allowance: bool = True,
    ) -> dict[str, object]:
        summary = dict(result_payload.get("summary", {}))
        row_count = int(summary.get("row_count", 0) or 0)
        final_balance_text = str(summary.get("final_balance_text", "0")).replace("Rs.", "").replace(",", "").strip()
        final_balance = float(final_balance_text or "0")
        seed = int(result_payload.get("generated_seed", 0) or 0)
        updated_at = _utcnow_text()
        payload_json = json.dumps({"config": config_payload, "result": result_payload}, ensure_ascii=True)

        with self._lock, self._connect() as connection:
            fresh_user = self._row_to_user(
                connection.execute(
                    """
                SELECT users.id, users.username, users.role, users.created_at,
                           users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                           users.full_name, users.address, users.mobile_number, users.email, users.gender,
                           COUNT(devices.id) AS active_device_count
                    FROM users
                    LEFT JOIN devices ON devices.user_id = users.id
                    WHERE users.id = ?
                    GROUP BY users.id
                    """,
                    (user.id,),
                ).fetchone()
            )
            if fresh_user is None:
                raise ValueError("The current user account could not be loaded.")

            existing = None
            if statement_id is not None and statement_id > 0:
                existing = connection.execute(
                    "SELECT id, user_id FROM statements WHERE id = ?",
                    (statement_id,),
                ).fetchone()
                if existing is not None and not fresh_user.is_admin and int(existing["user_id"]) != fresh_user.id:
                    raise PermissionError("You do not have access to update that saved statement.")

            if existing is None and consume_allowance:
                self._ensure_statement_allowed(fresh_user)

            if existing is None:
                cursor = connection.execute(
                    """
                    INSERT INTO statements (
                        user_id, created_at, updated_at, customer_name, start_date, end_date, issue_date,
                        final_balance, row_count, seed, payload_json, source_type
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        fresh_user.id,
                        updated_at,
                        updated_at,
                        str(config_payload.get("customer_name", "")).strip(),
                        str(config_payload.get("start_date", "")).strip(),
                        str(config_payload.get("end_date", "")).strip(),
                        str(result_payload.get("issue_date", "")).strip(),
                        final_balance,
                        row_count,
                        seed,
                        payload_json,
                        source_type or "generated",
                    ),
                )
                statement_id = int(cursor.lastrowid)
                self._increment_generated_statement_count(connection, fresh_user.id)
                if consume_allowance:
                    self._consume_statement_allowance(connection, fresh_user.id)
            else:
                connection.execute(
                    """
                    UPDATE statements
                    SET updated_at = ?, customer_name = ?, start_date = ?, end_date = ?, issue_date = ?,
                        final_balance = ?, row_count = ?, seed = ?, payload_json = ?, source_type = ?
                    WHERE id = ?
                    """,
                    (
                        updated_at,
                        str(config_payload.get("customer_name", "")).strip(),
                        str(config_payload.get("start_date", "")).strip(),
                        str(config_payload.get("end_date", "")).strip(),
                        str(result_payload.get("issue_date", "")).strip(),
                        final_balance,
                        row_count,
                        seed,
                        payload_json,
                        source_type or "edited",
                        int(existing["id"]),
                    ),
                )
                statement_id = int(existing["id"])

            connection.commit()
            self._prune_saved_statements(connection, fresh_user.id)
            connection.commit()
            refreshed_remaining_row = connection.execute(
                "SELECT remaining_statements, access_mode FROM users WHERE id = ?",
                (fresh_user.id,),
            ).fetchone()
        remaining = None
        if refreshed_remaining_row is not None and str(refreshed_remaining_row["access_mode"]) in {"limited", "monthly", "yearly"}:
            remaining = 0 if refreshed_remaining_row["remaining_statements"] is None else max(0, int(refreshed_remaining_row["remaining_statements"]))
        return {"statement_id": statement_id, "remaining_statements": remaining}

    def statement_history(self, user: AuthUser, selected_user_id: int | None = None) -> dict[str, object]:
        with self._lock, self._connect() as connection:
            users = connection.execute(
                """
                SELECT users.id, users.username, users.role, users.created_at,
                       users.access_mode, users.remaining_statements, users.valid_until, users.device_limit, users.generated_statement_count,
                       users.full_name, users.address, users.mobile_number, users.email, users.gender,
                       COUNT(devices.id) AS active_device_count
                FROM users
                LEFT JOIN devices ON devices.user_id = users.id
                GROUP BY users.id
                ORDER BY users.username COLLATE NOCASE
                """
            ).fetchall()
            users_by_id = {int(row["id"]): row for row in users}

            effective_selected_user_id: int | None = None
            if not user.is_admin:
                effective_selected_user_id = user.id
            elif selected_user_id is not None and selected_user_id in users_by_id:
                effective_selected_user_id = selected_user_id

            query = """
                SELECT statements.id, statements.created_at, statements.updated_at, statements.customer_name,
                       statements.start_date, statements.end_date, statements.issue_date, statements.final_balance,
                       statements.row_count, statements.seed, statements.source_type, users.username
                FROM statements
                JOIN users ON users.id = statements.user_id
            """
            params: tuple[Any, ...] = ()
            selected_username = ""
            if effective_selected_user_id is not None:
                query += " WHERE statements.user_id = ?"
                params = (effective_selected_user_id,)
                selected_username = str(users_by_id[effective_selected_user_id]["username"])
            query += f" ORDER BY statements.id DESC LIMIT {MAX_SAVED_STATEMENTS}"
            rows = connection.execute(query, params).fetchall()

        history_rows = [
            {
                "id": int(row["id"]),
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
                "username": str(row["username"]),
                "customer_name": str(row["customer_name"]),
                "start_date": str(row["start_date"]),
                "end_date": str(row["end_date"]),
                "issue_date": str(row["issue_date"]),
                "final_balance_text": f"Rs. {float(row['final_balance']):,.2f}",
                "row_count": int(row["row_count"]),
                "seed": int(row["seed"]),
                "source_type": str(row["source_type"]),
            }
            for row in rows
        ]

        statement_counts: dict[int, int] = {}
        for row in rows if effective_selected_user_id is not None else []:
            statement_counts[int(users_by_id.get(int(row["id"]), {}).get("id", 0))] = 0
        count_rows: list[dict[str, object]] = []
        with self._lock, self._connect() as connection:
            count_query = """
                SELECT users.id, users.username, users.access_mode, users.remaining_statements,
                       COALESCE(users.generated_statement_count, 0) AS generated_statement_count
                FROM users
                LEFT JOIN statements ON statements.user_id = users.id
            """
            count_params: tuple[Any, ...] = ()
            if effective_selected_user_id is not None:
                count_query += " WHERE users.id = ?"
                count_params = (effective_selected_user_id,)
            elif not user.is_admin:
                count_query += " WHERE users.id = ?"
                count_params = (user.id,)
            count_query += " GROUP BY users.id ORDER BY users.username COLLATE NOCASE"
            counts = connection.execute(count_query, count_params).fetchall()
        for row in counts:
            access_mode = str(row["access_mode"])
            remaining = None if access_mode not in {"limited", "monthly", "yearly"} or row["remaining_statements"] is None else max(0, int(row["remaining_statements"]))
            count_rows.append(
                {
                    "username": str(row["username"]),
                    "statement_count": max(0, int(row["generated_statement_count"] or 0)),
                    "remaining_statements": remaining,
                    "access_mode": access_mode,
                }
            )
        return {
            "history": history_rows,
            "counts": count_rows,
            "total_statements": len(history_rows),
            "selected_user_id": effective_selected_user_id,
            "selected_username": selected_username,
        }

    def statement_detail(self, user: AuthUser, statement_id: int) -> dict[str, object]:
        if statement_id < 1:
            raise ValueError("Select a valid saved statement first.")

        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT statements.id, statements.user_id, statements.payload_json, statements.source_type
                FROM statements
                WHERE statements.id = ?
                """,
                (statement_id,),
            ).fetchone()
        if row is None:
            raise ValueError("Saved statement was not found.")
        if not user.is_admin and int(row["user_id"]) != user.id:
            raise PermissionError("You do not have access to that saved statement.")

        try:
            payload = json.loads(str(row["payload_json"]))
        except json.JSONDecodeError as error:
            raise ValueError("Saved statement data is incomplete.") from error
        config = payload.get("config")
        result = payload.get("result")
        if not isinstance(config, dict) or not isinstance(result, dict):
            raise ValueError("Saved statement data is incomplete.")
        return {"id": int(row["id"]), "source_type": str(row["source_type"]), "config": config, "result": result}

    def delete_statement(self, acting_user: AuthUser, statement_id: int) -> dict[str, object]:
        if statement_id < 1:
            raise ValueError("Select a valid saved statement first.")
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT id, user_id FROM statements WHERE id = ?",
                (statement_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Saved statement was not found.")
            if not acting_user.is_admin and int(row["user_id"]) != acting_user.id:
                raise PermissionError("You do not have access to delete that saved statement.")
            connection.execute("DELETE FROM statements WHERE id = ?", (statement_id,))
            connection.commit()
        return {"deleted": True, "statement_id": statement_id}

    def devices_for_user(self, acting_user: AuthUser, target_user_id: int | None = None) -> dict[str, object]:
        resolved_user_id = acting_user.id if not acting_user.is_admin else int(target_user_id or acting_user.id)
        if not acting_user.is_admin and target_user_id not in (None, acting_user.id):
            raise PermissionError("You do not have access to that device list.")
        with self._lock, self._connect() as connection:
            user_row = connection.execute(
                "SELECT id, username FROM users WHERE id = ?",
                (resolved_user_id,),
            ).fetchone()
            if user_row is None:
                raise ValueError("Selected user was not found.")
            rows = connection.execute(
                """
                SELECT device_id, device_label, created_at, last_login_at
                FROM devices
                WHERE user_id = ?
                ORDER BY last_login_at DESC
                """,
                (resolved_user_id,),
            ).fetchall()
        return {
            "target_user_id": int(user_row["id"]),
            "target_username": str(user_row["username"]),
            "devices": [
                {
                    "device_id": str(row["device_id"]),
                    "device_label": str(row["device_label"]),
                    "created_at": str(row["created_at"]),
                    "last_login_at": str(row["last_login_at"]),
                }
                for row in rows
            ],
        }

    def remove_device(self, acting_user: AuthUser, target_user_id: int, device_id: str, password: str) -> dict[str, object]:
        normalized_device_id = self._normalize_device_id(device_id)
        if not normalized_device_id:
            raise ValueError("Select a device first.")
        if not password or not self.verify_user_password(acting_user.id, password):
            raise PermissionError("Enter your account password to remove a saved device.")
        if not acting_user.is_admin and target_user_id != acting_user.id:
            raise PermissionError("You do not have access to remove that device.")
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM auth_tokens WHERE user_id = ? AND device_id = ?",
                (target_user_id, normalized_device_id),
            )
            connection.execute(
                "DELETE FROM devices WHERE user_id = ? AND device_id = ?",
                (target_user_id, normalized_device_id),
            )
            connection.commit()
        return self.devices_for_user(acting_user, target_user_id)

    def log_activity(self, user_id: int | None, username: str, action: str, details: str = "") -> None:
        normalized_action = action.strip()
        if not normalized_action:
            return
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_activities (user_id, username, action_name, details_text, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, username.strip(), normalized_action, details.strip(), _utcnow_text()),
            )
            connection.commit()

    def recent_activities(self, acting_user: AuthUser, selected_user_id: int | None = None) -> dict[str, object]:
        if not acting_user.is_admin:
            raise PermissionError("Only the admin account can view user activities.")
        with self._lock, self._connect() as connection:
            if selected_user_id is not None and selected_user_id > 0:
                rows = connection.execute(
                    """
                    SELECT id, user_id, username, action_name, details_text, created_at
                    FROM user_activities
                    WHERE user_id = ?
                    ORDER BY id DESC
                    LIMIT 200
                    """,
                    (selected_user_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT id, user_id, username, action_name, details_text, created_at
                    FROM user_activities
                    ORDER BY id DESC
                    LIMIT 200
                    """
                ).fetchall()
        return {
            "activities": [
                {
                    "id": int(row["id"]),
                    "user_id": int(row["user_id"]) if row["user_id"] is not None else 0,
                    "username": str(row["username"]),
                    "action": str(row["action_name"]),
                    "details": str(row["details_text"] or ""),
                    "created_at": str(row["created_at"]),
                }
                for row in rows
            ]
        }


