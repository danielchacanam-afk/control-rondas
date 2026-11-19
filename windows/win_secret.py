"""Lectura de credenciales protegidas por DPAPI en el computador de destino."""
import base64
import ctypes
from ctypes import wintypes


def unprotect(encoded):
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

    raw = base64.b64decode(encoded, validate=True)
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source, target = Blob(len(raw), buffer), Blob()
    api = ctypes.WinDLL('crypt32', use_last_error=True)
    api.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    api.CryptUnprotectData.restype = wintypes.BOOL
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not api.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError('Windows no pudo abrir la credencial protegida de este computador')
    try:
        return ctypes.string_at(target.data, target.size).decode('utf-8')
    finally:
        ctypes.memset(target.data, 0, target.size)
        kernel.LocalFree(target.data)
