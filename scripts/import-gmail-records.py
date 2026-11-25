#!/usr/bin/env python3
"""Importe des fils Gmail (copies des mails Orange) dans la collection Firestore `emails-contacts`.

Usage : python3 scripts/import-gmail-records.py fichier.json

Le fichier est une liste d'objets : gmail_id (identifiant du premier message du fil),
from_email, from_name, subject, et date optionnelle (ISO UTC). Sans date, elle est
déduite de l'identifiant Gmail. Les fils déjà présents sont ignorés.
Variable d'environnement requise : FIREBASE_SERVICE_ACCOUNT_JSON.
"""
import hashlib
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account


def load_sync_module():
    spec = importlib.util.spec_from_file_location('sync', Path(__file__).with_name('sync-orange-mails.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def date_from_gmail_id(gmail_id):
    ms = int(gmail_id, 16) >> 20
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    sync = load_sync_module()
    info = json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT_JSON'])
    project = info['project_id']
    session = AuthorizedSession(
        service_account.Credentials.from_service_account_info(info, scopes=sync.SCOPES))

    records = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    created = present = 0
    for r in records:
        doc_id = hashlib.sha256(('gmail:' + r['gmail_id']).encode()).hexdigest()[:40]
        if sync.exists(session, project, doc_id):
            present += 1
            continue
        record = {
            'message_id': r['gmail_id'],
            'from_email': r.get('from_email', '').lower(),
            'from_name': r.get('from_name', ''),
            'subject': r.get('subject', ''),
            'snippet': r.get('snippet', ''),
            'date': r.get('date') or date_from_gmail_id(r['gmail_id']),
        }
        if sync.create(session, project, doc_id, record):
            created += 1

    print(f'{len(records)} fils traités · {created} ajoutés · {present} déjà présents')


if __name__ == '__main__':
    main()
