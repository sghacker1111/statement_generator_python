"""Persistent account lockout and hashed, one-use administrator recovery codes."""
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone


class AccountSecurityMixin:
    @staticmethod
    def _security_schema(connection):
        connection.execute('''CREATE TABLE IF NOT EXISTS account_security (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            login_locked INTEGER NOT NULL DEFAULT 0,
            recovery_hashes_json TEXT NOT NULL DEFAULT '[]',
            recovery_created_at TEXT NOT NULL DEFAULT ''
        )''')

    def security_status(self, user):
        user_id = user if isinstance(user, int) else user.id
        with self._lock, self._connect() as connection:
            row = connection.execute('SELECT * FROM account_security WHERE user_id=?', (user_id,)).fetchone()
        result = {'failed_login_attempts': int(row['failed_attempts']) if row else 0,
                  'login_locked': bool(row['login_locked']) if row else False, 'lockout_limit': 5}
        if isinstance(user, int) or user.is_admin:
            result.update(recovery_codes_remaining=len(json.loads(row['recovery_hashes_json'])) if row else 0,
                          recovery_created_at=row['recovery_created_at'] if row else '')
        return result

    def _login_attempt(self, connection, user_id, correct):
        connection.execute('INSERT OR IGNORE INTO account_security(user_id) VALUES(?)', (user_id,))
        row = connection.execute('SELECT * FROM account_security WHERE user_id=?', (user_id,)).fetchone()
        if row['login_locked']:
            return True
        count = 0 if correct else min(5, int(row['failed_attempts']) + 1)
        connection.execute('UPDATE account_security SET failed_attempts=?,login_locked=? WHERE user_id=?', (count, int(count>=5), user_id))
        if count>=5:
            connection.execute('DELETE FROM auth_tokens WHERE user_id=?', (user_id,))
        connection.commit()
        return count>=5

    def unlock_user_login(self, user_id):
        with self._lock, self._connect() as connection:
            row = connection.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
            if not row:
                raise ValueError('Select a valid user.')
            connection.execute('UPDATE account_security SET failed_attempts=0,login_locked=0 WHERE user_id=?', (user_id,))
            connection.commit()
        return self._row_to_user(row)

    def change_own_password(self, user, current, password):
        if not self.verify_user_password(user.id, current):
            raise ValueError('Current password is incorrect.')
        if len(password)<12:
            raise ValueError('Use a password of at least 12 characters.')
        if hmac.compare_digest(current, password):
            raise ValueError('Choose a different new password.')
        return self.update_user_password(user.id, password)

    @staticmethod
    def _code_hash(code):
        return hashlib.sha256(re.sub(r'[\s-]+','',code.strip()).upper().encode()).hexdigest()

    def generate_recovery_codes(self, user, password):
        if not user.is_admin or not self.verify_user_password(user.id, password):
            raise PermissionError('Enter your current admin password.')
        codes = ['SG-'+'-'.join(re.findall('.{4}', secrets.token_hex(12).upper())) for _ in range(10)]
        with self._lock, self._connect() as connection:
            connection.execute('INSERT OR IGNORE INTO account_security(user_id) VALUES(?)', (user.id,))
            connection.execute('UPDATE account_security SET recovery_hashes_json=?, recovery_created_at=? WHERE user_id=?',
                               (json.dumps([self._code_hash(code) for code in codes]), datetime.now(timezone.utc).isoformat(), user.id))
            connection.commit()
        return codes

    def recover_admin_password(self, username, code, password):
        if len(password)<12:
            raise ValueError('Use a password of at least 12 characters.')
        with self._lock, self._connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            user=connection.execute('SELECT * FROM users WHERE username=? AND role=?', (username.strip(),'admin')).fetchone()
            row=connection.execute('SELECT * FROM account_security WHERE user_id=?', (user['id'],)).fetchone() if user else None
            hashes=json.loads(row['recovery_hashes_json']) if row else []
            index=next((i for i,value in enumerate(hashes) if hmac.compare_digest(value,self._code_hash(code))), None)
            if index is None:
                raise ValueError('Invalid or already used recovery code.')
            hashes.pop(index)
            from auth_store import hash_password
            connection.execute('UPDATE account_security SET failed_attempts=0,login_locked=0,recovery_hashes_json=? WHERE user_id=?', (json.dumps(hashes),user['id']))
            connection.execute('UPDATE users SET password_hash=? WHERE id=?', (hash_password(password),user['id']))
            connection.execute('DELETE FROM auth_tokens WHERE user_id=?',(user['id'],))
            connection.commit()
