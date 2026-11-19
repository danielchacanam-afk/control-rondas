import json
from pathlib import Path
from urllib import error, request
from urllib.parse import urlsplit
import re


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_config(config_path):
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    if 'device_token_dpapi' in config:
        from win_secret import unprotect
        config['device_token'] = unprotect(config['device_token_dpapi'])
    project = urlsplit(config["url"])
    key = config["publishable_key"]
    token = config["device_token"]
    if (project.scheme != "https" or not re.fullmatch(r"[a-z0-9]+\.supabase\.co", project.netloc)
            or project.path not in ("", "/") or project.query or project.fragment
            or not key.startswith("sb_publishable_") or not re.fullmatch(r"[a-f0-9]{64}", token)):
        raise ValueError("Configuración de Supabase inválida")
    return config, project.netloc


def sync_pending(conn, config_path, device):
    if not config_path.exists():
        return 0
    config, host = load_config(config_path)
    key, token = config['publishable_key'], config['device_token']
    with conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS nube_enviadas (
            destino TEXT NOT NULL, equipo INTEGER NOT NULL, codigo TEXT NOT NULL,
            fecha TEXT NOT NULL, PRIMARY KEY(destino,equipo,codigo,fecha)
        )""")
    rows = conn.execute("""SELECT l.equipo,l.codigo,l.fecha,l.trama
        FROM lecturas l WHERE l.equipo=? AND NOT EXISTS (
          SELECT 1 FROM nube_enviadas n WHERE n.destino=? AND n.equipo=l.equipo
            AND n.codigo=l.codigo AND n.fecha=l.fecha
        ) ORDER BY l.fecha, l.codigo LIMIT 200""", (device, host)).fetchall()
    if not rows:
        return 0
    payload = {"equipo_id": device, "lote": [
        {"codigo": code, "fecha": stamp, "trama": raw.hex()} for _, code, stamp, raw in rows
    ]}
    req = request.Request(
        f"https://{host}/rest/v1/rpc/rondas_recibir",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "apikey": key, "x-rondas-token": token},
        method="POST",
    )
    try:
        with request.build_opener(NoRedirect()).open(req, timeout=12) as response:
            result = json.load(response)
    except error.HTTPError as exc:
        with exc:
            raise OSError(f"Supabase devolvió HTTP {exc.code}") from None
    if not isinstance(result, dict) or result.get("recibidas") != len(rows):
        raise OSError("Supabase no confirmó el lote completo")
    with conn:
        conn.executemany("INSERT OR IGNORE INTO nube_enviadas VALUES (?,?,?,?)", (
            (host, number, code, stamp) for number, code, stamp, _ in rows
        ))
    return len(rows)

