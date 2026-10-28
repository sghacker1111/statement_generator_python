from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from auth_store import AuthStore, ADMIN_PASSWORD


class AccountSecurityTests(TestCase):
    def test_account_locks_password_changes_and_one_use_admin_recovery(self):
        with TemporaryDirectory() as temporary:
            root=Path(temporary);store=AuthStore(root/'auth.db')
            admin=store.login('sgstatement',ADMIN_PASSWORD,'security-test')['user']
            user=store.create_user('secure-user','old-user-password','user','unlimited',None,'','Test','','000')
            session=store.login(user.username,'old-user-password')
            for _ in range(4):
                with self.assertRaises(ValueError):store.login(user.username,'wrong')
            self.assertEqual(store.security_status(user)['failed_login_attempts'],4)
            store.login(user.username,'old-user-password')
            self.assertEqual(store.security_status(user)['failed_login_attempts'],0)
            for _ in range(4):
                with self.assertRaises(ValueError):store.login(user.username,'wrong')
            with self.assertRaises(PermissionError):store.login(user.username,'wrong')
            with self.assertRaises(PermissionError):store.login(user.username,'old-user-password')
            with self.assertRaises(PermissionError):store.require_user(session['token'])
            store=AuthStore(root/'auth.db')
            self.assertTrue(store.security_status(user)['login_locked'])
            store.unlock_user_login(user.id)
            store.change_own_password(user,'old-user-password','new-user-secret-12345')
            store.login(user.username,'new-user-secret-12345')
            codes=store.generate_recovery_codes(admin,ADMIN_PASSWORD)
            self.assertEqual(len(set(codes)),10)
            for _ in range(4):
                with self.assertRaises(ValueError):store.login('sgstatement','wrong')
            with self.assertRaises(PermissionError):store.login('sgstatement','wrong')
            store.recover_admin_password('sgstatement',codes[0],'recovered-admin-secret-123')
            self.assertTrue(store.login('sgstatement','recovered-admin-secret-123','security-test')['user'].is_admin)
            with self.assertRaises(ValueError):store.recover_admin_password('sgstatement',codes[0],'another-admin-secret-123')
            self.assertEqual(store.security_status(admin)['recovery_codes_remaining'],9)
            store=AuthStore(root/'auth.db')
            self.assertTrue(store.login('sgstatement','recovered-admin-secret-123','security-test')['user'].is_admin)
            self.assertNotIn(codes[0].encode(),(root/'auth.db').read_bytes())
