"""Genera el recurso privado del instalador. No publica ni imprime credenciales."""
import argparse
import hashlib
import json
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_cloud import load_config


def build(program, driver, data, private, output, licenses):
    stage = Path(tempfile.mkdtemp(prefix='paquete-', dir=private))
    shutil.copytree(program, stage / 'programa')
    shutil.copytree(driver, stage / 'driver')
    for name in ('Instalar.ps1', 'Desinstalar.ps1', 'Desactivar.ps1'):
        shutil.copy2(Path(__file__).with_name(name), stage / name)
    config, _ = load_config(data / 'supabase.json')
    if config['url'] != 'https://mqzhxhvtfszjypwumizl.supabase.co':
        raise ValueError('Proyecto de nube inesperado')
    connection = {key: config[key] for key in ('url', 'publishable_key', 'device_token')}
    (stage / 'conexion.json').write_text(json.dumps(connection), encoding='utf-8')
    (stage / 'datos').mkdir()
    with closing(sqlite3.connect((data / 'lecturas.sqlite3').resolve().as_uri() + '?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(stage / 'datos' / 'lecturas.sqlite3')) as target:
            source.backup(target)
            if target.execute('pragma integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Copia de lecturas no válida')
            equipment = {r[0] for r in target.execute('select distinct equipo from lecturas')}
            if equipment - {5561}:
                raise ValueError('La base contiene lectores de otro traslado')
            count = target.execute('select count(*) from lecturas').fetchone()[0]
    for item in licenses:
        name, path = item.split('=', 1)
        dest = stage / 'programa' / 'licencias' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
    files = []
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            files.append({'path': path.relative_to(stage).as_posix(), 'size': path.stat().st_size,
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    (stage / 'manifest.json').write_text(json.dumps({'building': 'Brown Norte', 'reader': 5561,
        'seed_readings': count, 'private_package': True, 'files': files}, indent=2), encoding='utf-8')
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(stage).as_posix())
    print(json.dumps({'files': len(files), 'seed_readings': count, 'bytes': output.stat().st_size,
                      'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('program', 'driver', 'data', 'private', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--license', action='append', default=[])
    args = parser.parse_args()
    build(args.program, args.driver, args.data, args.private, args.output, args.license)
