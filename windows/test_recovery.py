import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError
import auxiliar as agent
import sync_cloud


class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        agent.ROOT = self.root
        agent.DB, agent.CSV = self.root / 'lecturas.sqlite3', self.root / 'lecturas.csv'
        self.config = self.root / 'supabase.json'
        self.config.write_text(json.dumps({'url': 'https://example.supabase.co',
            'publishable_key': 'sb_publishable_test', 'device_token': 'a'*64}))
        self.record = (5561, '25A0', '2026-11-18 12:24:23', bytes.fromhex('25a02324121811'))
        self.health = patch.object(agent, 'send_status').start()
        patch.object(agent.list_ports, 'comports', return_value=[]).start()

    def tearDown(self):
        patch.stopall()
        self.temp.cleanup()

    def download(self, on_verified=None):
        agent.save([self.record])
        return [self.record]

    def reply(self):
        reply = unittest.mock.MagicMock()
        reply.__enter__.return_value.read.return_value = b'{"recibidas":1,"nuevas":0}'
        return reply

    def test_offline_restart_reconnect_without_usb_and_duplicates(self):
        status = agent.read_status(self.root)
        with patch.object(agent, 'sync_once', side_effect=self.download), patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = URLError('sin red')
            agent.run_cycle(status)
        self.assertEqual(status['pending'], 1)
        self.assertEqual(status['total'], 1)
        self.assertTrue(agent.DB.exists())
        # Reinicio: estado y SQLite reabiertos desde disco, sin lector conectado.
        restarted = agent.read_status(self.root)
        with patch.object(agent, 'sync_once', return_value=None), patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.return_value = self.reply()
            agent.run_cycle(restarted)
            self.assertEqual(opener.return_value.open.call_count, 1)
        self.assertEqual(restarted['pending'], 0)
        self.assertEqual(restarted['usb'], 'disconnected')
        self.assertIsNotNone(restarted['last_upload'])
        # Reconectar y descargar la misma memoria no duplica ni reenvía confirmadas.
        with patch.object(agent, 'sync_once', side_effect=self.download), patch.object(sync_cloud.request, 'build_opener') as opener:
            agent.run_cycle(restarted)
            opener.assert_not_called()
        self.assertEqual(restarted['total'], 1)
        self.assertEqual(restarted['pending'], 0)
        with closing(sqlite3.connect(agent.DB)) as conn:
            self.assertEqual(conn.execute('pragma integrity_check').fetchone()[0], 'ok')

    def test_unconfirmed_reply_does_not_mark_upload(self):
        agent.save([self.record])
        reply = self.reply()
        reply.__enter__.return_value.read.return_value = b'{"recibidas":0}'
        with closing(sqlite3.connect(agent.DB)) as conn, patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.return_value = reply
            with self.assertRaises(OSError):
                sync_cloud.sync_pending(conn, self.config, 5561)
            self.assertEqual(conn.execute('select count(*) from nube_enviadas').fetchone()[0], 0)

    def test_usb_failure_does_not_block_pending_upload(self):
        agent.save([self.record])
        with patch.object(agent, 'sync_once', side_effect=agent.ProtocolError('CRC inválido')), patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.return_value = self.reply()
            status = agent.run_cycle(agent.read_status(self.root))
        self.assertEqual(status['usb'], 'error')
        self.assertEqual(status['pending'], 0)
        self.assertIn('CRC', status['usb_error'])

    def test_only_read_commands_are_allowed(self):
        for opcode in (0, 2, 3, 10):
            self.assertEqual(len(agent.frame(opcode)), 9)
        for opcode in set(range(256)) - {0, 2, 3, 10}:
            with self.assertRaises(ValueError):
                agent.frame(opcode)

    def test_verified_usb_is_published_before_waiting_for_internet(self):
        def connected(on_verified=None):
            on_verified()
            first = json.loads((self.root / 'estado.json').read_text())
            self.assertEqual(first['usb'], 'connected')
            self.assertEqual(first['download_state'], 'downloading')
            self.assertTrue(first['verified_at'])
            return self.download()

        def uploading(*args, **kwargs):
            snapshot = json.loads((self.root / 'estado.json').read_text())
            self.assertEqual(snapshot['usb'], 'connected')
            self.assertEqual(snapshot['download_state'], 'idle')
            self.assertTrue(snapshot['last_download'])
            return self.reply()

        with patch.object(agent, 'sync_once', side_effect=connected), patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = uploading
            agent.run_cycle(agent.read_status(self.root))

    def test_usb_error_is_published_before_a_cloud_upload(self):
        agent.save([self.record])
        def uploading(*args, **kwargs):
            snapshot = json.loads((self.root / 'estado.json').read_text())
            self.assertEqual(snapshot['usb'], 'error')
            self.assertEqual(snapshot['download_state'], 'error')
            return self.reply()
        with patch.object(agent, 'sync_once', side_effect=agent.ProtocolError('Puerto sin respuesta')), patch.object(sync_cloud.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = uploading
            agent.run_cycle(agent.read_status(self.root))

    def test_wrong_device_never_publishes_a_successful_verification(self):
        callback = unittest.mock.Mock()
        with patch.object(agent.serial, 'Serial'), patch.object(agent, 'Reader') as reader:
            reader.return_value.exchange.side_effect = [b'\x8a', b'\x82\x01\x00']
            with self.assertRaises(agent.ProtocolError):
                agent.download('COM99', on_verified=callback)
        callback.assert_not_called()


if __name__ == '__main__':
    unittest.main()
