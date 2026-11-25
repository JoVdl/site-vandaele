#!/usr/bin/env python3
"""Synchronise la boîte Orange vers la collection Firestore `emails-contacts`.

Variables d'environnement :
  ORANGE_IMAP_USER       adresse complète (vandaelemarcel@orange.fr)
  ORANGE_IMAP_PASSWORD   mot de passe Orange (ou mot de passe d'application)
  FIREBASE_SERVICE_ACCOUNT_JSON   contenu JSON de la clé de compte de service
  SYNC_SINCE             date IMAP de départ, ex. 01-Jan-2026 (optionnel)

Usage : python3 scripts/sync-orange-mails.py [--dry-run]
Les mails déjà présents ne sont pas réécrits : les statuts saisis dans l'admin sont conservés.
"""
import hashlib
import imaplib
import json
import os
import re
import sys
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

IMAP_HOST = 'imap.orange.fr'
IMAP_PORT = 993
COLLECTION = 'emails-contacts'
SINCE = os.environ.get('SYNC_SINCE', '01-Jan-2026')
SKIP_SENDER = re.compile(r'no-?reply|donotreply|do-not-reply|notification|mailer-daemon|newsletter|postmaster', re.I)
SNIPPET_LEN = 400
DRY_RUN = '--dry-run' in sys.argv
SCOPES = ['https://www.googleapis.com/auth/datastore']


def header_text(value):
    if not value:
        return ''
    return str(make_header(decode_header(value))).strip()


def doc_id_for(message_id, fallback_key):
    key = message_id.strip() or fallback_key
    return hashlib.sha256(key.encode()).hexdigest()[:40]


def snippet_of(msg):
    for part in msg.walk():
        if part.get_content_type() == 'text/plain' and not part.get_filename():
            raw = part.get_payload(decode=True) or b''
            text = raw.decode(part.get_content_charset() or 'utf-8', errors='replace')
            return re.sub(r'\s+', ' ', text).strip()[:SNIPPET_LEN]
    return ''


def parse_date(value):
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        dt = None
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def fetch_headers(imap, num):
    _, data = imap.fetch(num, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)])')
    return message_from_bytes(data[0][1])


def fetch_full(imap, num):
    _, data = imap.fetch(num, '(BODY.PEEK[])')
    return message_from_bytes(data[0][1])


def doc_url(project, doc_id):
    return (f'https://firestore.googleapis.com/v1/projects/{project}'
            f'/databases/(default)/documents/{COLLECTION}/{doc_id}')


def exists(session, project, doc_id):
    resp = session.get(doc_url(project, doc_id))
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    return True


def create(session, project, doc_id, record):
    body = {'fields': {
        'message_id':  {'stringValue': record['message_id']},
        'from_email':  {'stringValue': record['from_email']},
        'from_name':   {'stringValue': record['from_name']},
        'subject':     {'stringValue': record['subject']},
        'snippet':     {'stringValue': record['snippet']},
        'date':        {'timestampValue': record['date']},
        'synced_at':   {'timestampValue': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},
        'source':      {'stringValue': 'orange'},
    }}
    resp = session.patch(doc_url(project, doc_id), params={'currentDocument.exists': 'false'}, json=body)
    if resp.status_code == 200:
        return True
    if resp.status_code == 400:
        return False
    resp.raise_for_status()
    return False


def main():
    creds_info = json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT_JSON'])
    project = creds_info['project_id']
    session = AuthorizedSession(
        service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES))

    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    imap.login(os.environ['ORANGE_IMAP_USER'], os.environ['ORANGE_IMAP_PASSWORD'])
    try:
        imap.select('INBOX', readonly=True)
        _, data = imap.search(None, 'SINCE', SINCE)
        ids = data[0].split()
        created = skipped = present = 0

        for num in ids:
            head = fetch_headers(imap, num)
            from_name, from_email = parseaddr(header_text(head.get('From')))
            from_email = from_email.lower()
            if not from_email or SKIP_SENDER.search(from_email):
                skipped += 1
                continue

            message_id = (head.get('Message-ID') or '').strip()
            fallback = '|'.join([head.get('From', ''), head.get('Date', ''), head.get('Subject', '')])
            doc_id = doc_id_for(message_id, fallback)

            if exists(session, project, doc_id):
                present += 1
                continue

            if DRY_RUN:
                print(f'[dry-run] nouveau : {header_text(head.get("Subject"))}')
                created += 1
                continue

            full = fetch_full(imap, num)
            record = {
                'message_id': message_id or fallback,
                'from_email': from_email,
                'from_name':  from_name,
                'subject':    header_text(full.get('Subject')),
                'snippet':    snippet_of(full),
                'date':       parse_date(full.get('Date')).strftime('%Y-%m-%dT%H:%M:%SZ'),
            }
            if create(session, project, doc_id, record):
                created += 1

        print(f'{len(ids)} mails lus depuis {SINCE} · {created} ajoutés · '
              f'{present} déjà présents · {skipped} ignorés (expéditeurs automatiques)')
    finally:
        imap.logout()


if __name__ == '__main__':
    main()
