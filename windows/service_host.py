"""Host nativo SCM; no requiere Python instalado ni sesión interactiva."""
import ctypes
from ctypes import wintypes as W
import logging
import threading

NAME = 'ControlRondasJWM'


def dispatch(run):
    api = ctypes.WinDLL('advapi32', use_last_error=True)
    stop = threading.Event()
    main_type = ctypes.WINFUNCTYPE(None, W.DWORD, ctypes.POINTER(W.LPWSTR))
    handler_type = ctypes.WINFUNCTYPE(W.DWORD, W.DWORD, W.DWORD, W.LPVOID, W.LPVOID)

    class Status(ctypes.Structure):
        _fields_ = [(key, W.DWORD) for key in ('kind', 'state', 'accepted', 'error', 'specific', 'checkpoint', 'wait')]

    class Entry(ctypes.Structure):
        _fields_ = [('name', W.LPWSTR), ('main', main_type)]

    api.RegisterServiceCtrlHandlerExW.argtypes = [W.LPCWSTR, handler_type, W.LPVOID]
    api.RegisterServiceCtrlHandlerExW.restype = W.HANDLE
    api.SetServiceStatus.argtypes = [W.HANDLE, ctypes.POINTER(Status)]
    api.SetServiceStatus.restype = W.BOOL
    api.StartServiceCtrlDispatcherW.argtypes = [ctypes.POINTER(Entry)]
    api.StartServiceCtrlDispatcherW.restype = W.BOOL
    handle = None

    def report(state, error=0):
        accepted = 5 if state == 4 else 0  # STOP | SHUTDOWN cuando RUNNING.
        status = Status(0x10, state, accepted, error, 0, 1 if state in (2, 3) else 0, 60000 if state in (2, 3) else 0)
        if not api.SetServiceStatus(handle, ctypes.byref(status)):
            raise ctypes.WinError(ctypes.get_last_error())

    @handler_type
    def handler(control, _event, _data, _context):
        if control in (1, 5):
            report(3)
            stop.set()
        return 0

    @main_type
    def service_main(_argc, _argv):
        nonlocal handle
        handle = api.RegisterServiceCtrlHandlerExW(NAME, handler, None)
        if not handle:
            return
        report(2)
        try:
            report(4)
            code = run(stop)
            report(1, code or 0)
        except BaseException:
            logging.exception('El servicio se detuvo por un error inesperado')
            report(1, 1)

    table = (Entry * 2)(Entry(NAME, service_main), Entry(None, main_type()))
    if not api.StartServiceCtrlDispatcherW(table):
        raise ctypes.WinError(ctypes.get_last_error())
