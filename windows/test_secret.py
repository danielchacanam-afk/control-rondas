import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import tempfile
import unittest
from sync_cloud import load_config
from win_secret import unprotect


@unittest.skipUnless(os.name == 'nt', 'DPAPI requiere Windows')
class Secrets(unittest.TestCase):
    def protect(self, text):
        class Blob(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
        raw = text.encode()
        buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        source, target = Blob(len(raw), buffer), Blob()
        api = ctypes.WinDLL('crypt32', use_last_error=True)
        api.CryptProtectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_wchar_p, ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        api.CryptProtectData.restype = wintypes.BOOL
        self.assertTrue(api.CryptProtectData(ctypes.byref(source), None, None, None, None, 5, ctypes.byref(target)))
        try:
            return base64.b64encode(ctypes.string_at(target.data, target.size)).decode()
        finally:
            kernel = ctypes.WinDLL('kernel32')
            kernel.LocalFree.argtypes = [ctypes.c_void_p]
            kernel.LocalFree.restype = ctypes.c_void_p
            kernel.LocalFree(target.data)

    def test_machine_credential_roundtrip_and_validation(self):
        protected = self.protect('a' * 64)
        self.assertEqual(unprotect(protected), 'a' * 64)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'supabase.json'
            path.write_text(json.dumps({'url': 'https://example.supabase.co',
                'publishable_key': 'sb_publishable_test', 'device_token_dpapi': protected}))
            data, host = load_config(path)
            self.assertEqual(host, 'example.supabase.co')
            self.assertEqual(data['device_token'], 'a' * 64)

    def test_invalid_protected_blob_is_rejected(self):
        with self.assertRaises(OSError):
            unprotect(base64.b64encode(b'invalid').decode())


if __name__ == '__main__':
    unittest.main()
