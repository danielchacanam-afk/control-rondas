import json
from datetime import datetime, timezone
from urllib import request
from sync_cloud import NoRedirect, load_config


def now():
    return datetime.now(timezone.utc).isoformat()


def read_status(root):
    try:
        data = json.loads((root / 'estado.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = {}
    return {**data, 'usb': 'disconnected', 'port': None, 'usb_error': None, 'cloud_error': None}


def store_status(root, status):
    temporary = root / 'estado.json.tmp'
    temporary.write_text(json.dumps(status, ensure_ascii=False), encoding='utf-8')
    temporary.replace(root / 'estado.json')


def send_status(config_path, device, status):
    config, host = load_config(config_path)
    payload = {'equipo_id': device, 'estado': {key: status.get(key) for key in (
        'usb', 'port', 'last_download', 'last_upload', 'pending', 'total', 'usb_error', 'cloud_error', 'mode', 'version'
    )}}
    req = request.Request('https://' + host + '/rest/v1/rpc/rondas_informar_estado',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json',
        'apikey': config['publishable_key'], 'x-rondas-token': config['device_token']}, method='POST')
    with request.build_opener(NoRedirect()).open(req, timeout=8) as response:
        if json.load(response) is not True:
            raise OSError('La nube no confirmó el estado del lector')
