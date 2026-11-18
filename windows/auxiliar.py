import argparse
import csv
import logging
import os
import sqlite3
import sys
import time
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
ROOT = Path(os.environ["LOCALAPPDATA"]) / "Control de Rondas"
DB = ROOT / "lecturas.sqlite3"
CSV = ROOT / "lecturas.csv"


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


def main():
    import msvcrt
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Descargar una vez y salir")
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", handlers=[
        logging.FileHandler(ROOT / "auxiliar.log", encoding="utf-8"),
        logging.StreamHandler(),
    ])
    with (ROOT / "auxiliar.lock").open("a+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            logging.error("Ya hay un auxiliar de rondas activo.")
            return 1
        if args.once:
            try:
                records = sync_once()
                if records is None:
                    raise ProtocolError("No hay lector conectado.")
                for device, code, stamp, _ in records:
                    print(stamp, code, device)
                return 0
            except (OSError, TimeoutError, ProtocolError, sqlite3.Error) as error:
                logging.error("%s", error)
                return 1
        state = None
        while True:
            try:
                records = sync_once()
                if records is None and state != "disconnected":
                    logging.info("Esperando la conexión USB del lector.")
                state = "disconnected" if records is None else "connected"
            except (OSError, TimeoutError, ProtocolError, sqlite3.Error) as error:
                if str(error) != state:
                    logging.warning("%s", error)
                    state = str(error)
            try:
                config = ROOT / "supabase.json"
                if config.exists():
                    with closing(database()) as conn:
                        sent = sync_pending(conn, config, DEVICE)
                    if sent:
                        logging.info("Supabase confirmó %s marcaciones.", sent)
            except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
                logging.warning("Sincronización pendiente: %s", error)
            time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())


