import argparse
import csv
import json
import logging
import os
import sqlite3
import sys
import time
import threading
from logging.handlers import RotatingFileHandler
from health import now, read_status, store_status, send_status
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from sync_cloud import sync_pending

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "dependencias"))
import serial
from serial.tools import list_ports

TZ = ZoneInfo("America/Santiago")
DEVICE = 5561
CAPACITY_PACKETS = 16000
USB_ID = (0x10C4, 0xEA60)
ROOT = Path(os.environ.get("LOCALAPPDATA", os.environ.get("PROGRAMDATA", "."))) / "Control de Rondas"
DB = ROOT / "lecturas.sqlite3"
CSV = ROOT / "lecturas.csv"
STOP = threading.Event()


class ProtocolError(Exception):
    pass


def frame(opcode):
    # Approved operations: wake, identify, start a read and fetch a page.
    if opcode not in (0x0A, 0x02, 0x03, 0x00):
        raise ValueError("Operación USB fuera de la lista de lectura")
    return bytes((0xD5, 0xD5, 1, 0, opcode, opcode, 0, 13, 10))


class Reader:
    def __init__(self, port):
        self.port = port
        self.pending = bytearray()

    def response(self, opcode, timeout=1.8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if STOP.is_set():
                raise InterruptedError('Descarga interrumpida por parada del servicio')
            while len(self.pending) >= 4:
                if self.pending[:2] != b"\xd5\xd5":
                    del self.pending[0]
                    continue
                size = int.from_bytes(self.pending[2:4], "little")
                if not 1 <= size <= 8192:
                    raise ProtocolError(f"Longitud USB fuera de rango: {size}")
                if len(self.pending) < size + 8:
                    break
                packet = bytes(self.pending[:size+8])
                del self.pending[:size+8]
                payload = packet[4:4+size]
                if packet[-2:] != b"\r\n" or sum(payload) & 0xFFFF != int.from_bytes(packet[-4:-2], "little"):
                    raise ProtocolError("La trama USB no pasó la comprobación de integridad")
                if payload[0] == opcode:
                    return payload
            self.pending.extend(self.port.read(min(self.port.in_waiting or 1, 8192)))
        raise TimeoutError(f"Sin respuesta a la petición {opcode:02X}")

    def exchange(self, command, reply, timeout=1.8):
        self.port.write(frame(command))
        return self.response(reply, timeout)


def bcd(value):
    high, low = divmod(value, 16)
    if high > 9 or low > 9:
        raise ProtocolError("La fecha de la marcación contiene un valor inválido")
    return high * 10 + low


def decode_page(payload, expected_page, now):
    if len(payload) != 38 or int.from_bytes(payload[1:3], "little") != expected_page:
        raise ProtocolError("Formato o número de paquete inesperado")
    for offset in range(3, len(payload), 7):
        raw = payload[offset:offset+7]
        if raw == b"\xff" * 7:
            continue
        second, minute, hour, day, month = map(bcd, raw[2:])
        # The 7-byte format omits year. Use the most recent plausible occurrence.
        for year in range(now.year, now.year - 9, -1):
            try:
                stamp = datetime(year, month, day, hour, minute, second, tzinfo=TZ)
            except ValueError:
                continue
            if stamp <= now + timedelta(minutes=10):
                break
        else:
            raise ProtocolError("El lector devolvió una fecha fuera de rango")
        yield DEVICE, raw[:2].hex().upper(), stamp.strftime("%Y-%m-%d %H:%M:%S"), raw


def download(port_name):
    now = datetime.now(TZ)
    with serial.Serial(port_name, 57600, timeout=0.12, write_timeout=1.5) as port:
        reader = Reader(port)
        for attempt in range(3):
            try:
                reader.exchange(0x0A, 0x8A, timeout=0.65)
                break
            except TimeoutError:
                if attempt == 2:
                    raise
        identity = reader.exchange(0x02, 0x82)
        if len(identity) != 3 or int.from_bytes(identity[1:], "little") != DEVICE:
            raise ProtocolError("El puerto no corresponde al lector JWM 5561")
        start = reader.exchange(0x03, 0x83)
        if len(start) != 3:
            raise ProtocolError("Cabecera de descarga inesperada")
        pages = int.from_bytes(start[1:], "little")
        if pages > CAPACITY_PACKETS:
            raise ProtocolError("Cantidad de paquetes fuera de rango")
        records = []
        for index in range(pages):
            records.extend(decode_page(reader.exchange(0x00, 0x93), index, now))
        return records


def database():
    ROOT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=10)
    conn.execute("""CREATE TABLE IF NOT EXISTS lecturas (
        equipo INTEGER NOT NULL, codigo TEXT NOT NULL, fecha TEXT NOT NULL,
        trama BLOB NOT NULL, PRIMARY KEY(equipo, codigo, fecha)
    )""")
    return conn


def save(records):
    with closing(database()) as conn:
        with conn:
            cursor = conn.executemany("INSERT OR IGNORE INTO lecturas VALUES (?, ?, ?, ?)", records)
            added = cursor.rowcount
        rows = conn.execute("SELECT fecha, codigo, '', equipo FROM lecturas ORDER BY fecha, equipo, codigo").fetchall()
        temporary = CSV.with_suffix(".csv.tmp")
        with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.writer(stream, delimiter=";")
            writer.writerow(("Fecha y hora", "Código", "Punto de control", "Equipo"))
            writer.writerows(rows)
        temporary.replace(CSV)
    return added


def sync_once():
    ports = [port.device for port in list_ports.comports() if (port.vid, port.pid) == USB_ID]
    if not ports:
        return None
    if len(ports) != 1:
        raise ProtocolError("Hay más de un CP210x conectado. Conecta solo el lector de rondas.")
    records = download(ports[0])
    added = save(records)
    logging.info("%s, lector %s: %s descargadas, %s nuevas, %s duplicadas.",
                 ports[0], DEVICE, len(records), added, len(records) - added)
    return records


def run_cycle(status):
    try:
        ports = [p.device for p in list_ports.comports() if (p.vid, p.pid) == USB_ID]
        status['port'] = ports[0] if len(ports) == 1 else None
        records = sync_once()
        status['usb'] = 'connected' if records is not None else 'disconnected'
        status['usb_error'] = None
        if records is not None:
            status['last_download'] = now()
    except (OSError, TimeoutError, ProtocolError, sqlite3.Error) as error:
        status['usb'] = 'error'
        status['usb_error'] = str(error)[:500]
        logging.warning('USB: %s', error)
    config = ROOT / 'supabase.json'
    try:
        with closing(database()) as conn:
            sent = sync_pending(conn, config, DEVICE)
            if sent:
                status['last_upload'] = now()
                logging.info('Supabase confirmó %s marcaciones.', sent)
            status['total'] = conn.execute('SELECT count(*) FROM lecturas WHERE equipo=?', (DEVICE,)).fetchone()[0]
            if config.exists():
                from sync_cloud import load_config
                _, host = load_config(config)
                status['pending'] = conn.execute('''SELECT count(*) FROM lecturas l WHERE l.equipo=? AND NOT EXISTS
                    (SELECT 1 FROM nube_enviadas n WHERE n.destino=? AND n.equipo=l.equipo AND n.codigo=l.codigo AND n.fecha=l.fecha)''', (DEVICE, host)).fetchone()[0]
            else:
                status['pending'] = status['total']
        status['cloud_error'] = None if config.exists() else 'Falta configurar el envío a la nube'
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        status['cloud_error'] = str(error)[:500]
        # Cuenta pendientes también cuando falla el envío, sin alterar las confirmadas.
        with closing(database()) as conn:
            status['total'] = conn.execute('SELECT count(*) FROM lecturas WHERE equipo=?', (DEVICE,)).fetchone()[0]
            try:
                from sync_cloud import load_config
                _, host = load_config(config)
                status['pending'] = conn.execute('''SELECT count(*) FROM lecturas l WHERE l.equipo=? AND NOT EXISTS
                    (SELECT 1 FROM nube_enviadas n WHERE n.destino=? AND n.equipo=l.equipo AND n.codigo=l.codigo AND n.fecha=l.fecha)''', (DEVICE, host)).fetchone()[0]
            except (OSError, ValueError, KeyError, sqlite3.Error):
                status['pending'] = status['total']
        logging.warning('Sincronización pendiente: %s', error)
    status['checked_at'] = now()
    store_status(ROOT, status)
    if config.exists():
        try:
            send_status(config, DEVICE, status)
        except (OSError, ValueError, KeyError, TypeError) as error:
            logging.warning('Estado pendiente de envío: %s', error)
    return status


def run(stop):
    global STOP
    STOP = stop
    import msvcrt
    ROOT.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s', handlers=[
        RotatingFileHandler(ROOT / 'auxiliar.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8'),
    ], force=True)
    with (ROOT / 'auxiliar.lock').open('a+b') as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            logging.error('Ya hay un auxiliar de rondas activo.')
            return 1
        logging.info('Auxiliar 2.0 iniciado (%s).', 'servicio' if '--service' in sys.argv else 'sesión')
        status = read_status(ROOT)
        status.update(mode='service' if '--service' in sys.argv else 'session', version='2.0')
        while not stop.is_set():
            run_cycle(status)
            stop.wait(30)
        logging.info('Auxiliar detenido de forma controlada.')
    return 0


def main():
    global ROOT, DB, CSV
    parser = argparse.ArgumentParser()
    parser.add_argument('--service', action='store_true')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--data-dir', type=Path, default=ROOT)
    parser.add_argument('--backup-from', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    ROOT = args.data_dir.resolve()
    DB, CSV = ROOT / 'lecturas.sqlite3', ROOT / 'lecturas.csv'
    if args.verify:
        with closing(sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)) as conn:
            integrity = conn.execute('pragma integrity_check').fetchone()[0]
            count = conn.execute('select count(*) from lecturas').fetchone()[0]
        print(json.dumps({'integrity': integrity, 'readings': count}))
        return 0 if integrity == 'ok' else 1
    if args.backup_from:
        ROOT.mkdir(parents=True, exist_ok=True)
        if DB.exists():
            raise FileExistsError('Ya existe la base de destino; no se sobrescribirá')
        with closing(sqlite3.connect(args.backup_from.resolve().as_uri() + '?mode=ro', uri=True)) as source:
            with closing(sqlite3.connect(DB)) as target:
                source.backup(target)
        return 0
    if args.service:
        from service_host import dispatch
        dispatch(run)
        return 0
    if args.once:
        # Una descarga local de diagnóstico. No envía ni borra datos del dispositivo.
        ROOT.mkdir(parents=True, exist_ok=True)
        records = sync_once()
        if records is None:
            raise ProtocolError('No hay lector conectado.')
        print('Descargadas:', len(records))
        return 0
    return run(threading.Event())


if __name__ == '__main__':
    sys.exit(main())
