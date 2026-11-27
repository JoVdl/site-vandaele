#!/usr/bin/env python3
"""Synchronise la boîte Orange vers la collection Firestore `emails-contacts`.

Variables d'environnement :
  ORANGE_IMAP_USER       adresse complète (vandaelemarcel@orange.fr)
  ORANGE_IMAP_PASSWORD   mot de passe Orange (ou mot de passe d'application)
  FIREBASE_SERVICE_ACCOUNT_JSON   contenu JSON de la clé de compte de service
  SYNC_SINCE             date IMAP de départ, ex. 01-Jan-2026 (optionnel)

Usage : python3 scripts/sync-orange-mails.py [--dry-run]
        python3 scripts/sync-orange-mails.py --watch
  --watch : reste allumé et lance la synchro dès que le bouton « Rafraîchir les mails »
            de l'admin écrit une demande (document config/sync-orange).
Les mails déjà présents ne sont pas réécrits : les statuts saisis dans l'admin sont conservés.
"""
import hashlib
import imaplib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

IMAP_HOST = 'imap.orange.fr'
IMAP_PORT = 993
COLLECTION = 'emails-contacts'
SINCE = os.environ.get('SYNC_SINCE', '29-May-2026')
SKIP_SENDER = re.compile(r'no-?reply|ne[-_]?pas[-_]?repondre|donotreply|do-not-reply|notification|mailer-daemon|postmaster|newsletter|news\.|actu@|marketing|promo|mailing|alerte|dematis|shipup|chronopost|avis-verifies|agrizone|bercy|ameli|hellobank|leroymerlin|kiloutou|made-in-china|zepros|profieldevents|robotshop', re.I)
OWN_DOMAIN = 'curagevandaele.fr'  # le formulaire du site n'est jamais filtré
# Marqueurs de publicité / newsletter / notification, cherchés dans l'objet et le texte
AD_CONTENT = re.compile(
    r"d[ée]sinscri|d[ée]sabonn|unsubscri|"
    r"voir (?:le mail|ce mail|dans (?:votre|le) navigateur)|view in (?:your )?browser|"
    r"soldes?\b|solde[sz]|promo(?:tion)?s?\b|black friday|boxing day|-\s?\d{1,2}\s?%|\d{1,2}\s?% de (?:réduction|remise)|"
    r"bons? plans?|destockage|déstockage|remise exclusive|offres? exclusives?|"
    r"webinaire|webinar|newsletter|récap(?:itulatif)? hebdo|sélection hebdomadaire|"
    r"découvrez|decouvrez|nouveauté|nouveautés|nouveau catalogue|catalogue|"
    r"meilleurs v(?:œ|oe)ux|bonne année|excellente année|félicitations|bienvenue|"
    r"votre colis|suivi de (?:votre|la) (?:commande|livraison)|votre commande|confirmation de commande|"
    r"offre spéciale|profitez|ne nous quittez pas|cadeau|coupon|jeu concours|sondage|"
    r"enquête de satisfaction|donnez votre avis|votre avis|laissez un avis",
    re.I)
MAIL_TEXT_LIMIT = 20000
SNIPPET_LEN = 400
DRY_RUN = '--dry-run' in sys.argv
SCOPES = ['https://www.googleapis.com/auth/datastore']
REQUEST_DOC = 'config/sync-orange'   # demande (requested_at) et résultat (last_done_at) écrits par l'admin et le script
WATCH_INTERVAL = 60                  # secondes entre deux vérifications en mode --watch


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


def body_of(msg):
    chunks = []
    for part in msg.walk():
        if part.get_content_type() == 'text/plain' and not part.get_filename():
            raw = part.get_payload(decode=True) or b''
            chunks.append(raw.decode(part.get_content_charset() or 'utf-8', errors='replace'))
    return re.sub(r'\s+', ' ', ' '.join(chunks))[:MAIL_TEXT_LIMIT]


def normalize_subject(text):
    return re.sub(r'^((re|tr|fw|fwd)\s*:\s*)+', '', (text or '').strip().lower())


def already_imported(session, project, from_email, subject, date_iso):
    """Vrai si un mail du même expéditeur, avec le même objet et une date à moins de 2 jours, existe déjà."""
    query = {'structuredQuery': {
        'from': [{'collectionId': COLLECTION}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'from_email'}, 'op': 'EQUAL',
                                  'value': {'stringValue': from_email}}},
        'limit': 200}}
    resp = session.post(f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents:runQuery',
                        json=query)
    resp.raise_for_status()
    target = datetime.fromisoformat(date_iso.replace('Z', '+00:00'))
    wanted = normalize_subject(subject)
    for item in resp.json():
        doc = item.get('document')
        if not doc:
            continue
        fields = doc['fields']
        if normalize_subject(fields.get('subject', {}).get('stringValue', '')) != wanted:
            continue
        ts = fields.get('date', {}).get('timestampValue', '')
        if ts and abs((parse_ts(ts) - target).total_seconds()) < 2 * 86400:
            return True
    return False


def is_advertising(subject, from_email, body):
    if from_email.endswith('@' + OWN_DOMAIN):
        return False
    return bool(SKIP_SENDER.search(from_email) or AD_CONTENT.search(subject)
                or AD_CONTENT.search(from_email) or AD_CONTENT.search(body))


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
    _, data = imap.fetch(num, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE LIST-UNSUBSCRIBE LIST-ID PRECEDENCE AUTO-SUBMITTED)])')
    return message_from_bytes(data[0][1])


def is_automatic(head, from_email):
    """Newsletters, envois de masse, notifications automatiques : pas des mails clients."""
    if from_email.endswith('@' + OWN_DOMAIN):
        return False
    if SKIP_SENDER.search(from_email):
        return True
    if head.get('List-Unsubscribe') or head.get('List-Id'):
        return True
    if (head.get('Precedence') or '').strip().lower() in ('bulk', 'list', 'junk'):
        return True
    if (head.get('Auto-Submitted') or 'no').strip().lower() != 'no':
        return True
    return False


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
    # 400 : document déjà là ; 409 : créé entre-temps par une autre synchro (tâche horaire + surveillance)
    if resp.status_code in (400, 409):
        return False
    resp.raise_for_status()
    return False


REPLY_CUT = re.compile(r'^\s*(Le .+ a écrit|On .+ wrote|De ?:|From:|Envoyé ?:|-{3,}|_{5,}|Cordialement|Bien cordialement)', re.I)


def new_text(msg, limit=800):
    """Texte propre d'un message : sans les citations ni le texte repris du mail précédent."""
    raw = ''
    for part in msg.walk():
        if part.get_content_type() == 'text/plain' and not part.get_filename():
            raw = (part.get_payload(decode=True) or b'').decode(part.get_content_charset() or 'utf-8', errors='replace')
            break
    kept = []
    for line in raw.splitlines():
        if line.lstrip().startswith('>'):
            continue
        if REPLY_CUT.match(line) and kept:
            break
        kept.append(line)
    return re.sub(r'\s+', ' ', ' '.join(kept)).strip()[:limit]


def find_sent_folder(imap):
    """Nom du dossier « Envoyés » tel que le serveur le désigne (drapeau \\Sent)."""
    _, folders = imap.list()
    for raw in folders or []:
        line = raw.decode(errors='replace') if isinstance(raw, bytes) else str(raw)
        if '\\Sent' in line:
            match = re.search(r'\) "[^"]*" (.+)$', line)
            if match:
                return match.group(1).strip().strip('"')
    return 'Sent'


def refs_of(head):
    return re.findall(r'<[^>]+>', (head.get('In-Reply-To') or '') + ' ' + (head.get('References') or ''))


def find_thread_doc(session, project, refs, from_email, subject, when, loose=False):
    """Document existant du fil : d'abord par en-tête (In-Reply-To / References), puis par expéditeur + objet.
    loose=True (réponses envoyées) : à défaut d'objet identique, le dernier mail reçu de ce correspondant dans les 90 jours."""
    for ref in refs:
        doc_id = doc_id_for(ref, '')
        if exists(session, project, doc_id):
            return doc_id
    if not from_email:
        return None
    query = {'structuredQuery': {
        'from': [{'collectionId': COLLECTION}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'from_email'}, 'op': 'EQUAL',
                                  'value': {'stringValue': from_email}}},
        'limit': 200}}
    resp = session.post(f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents:runQuery',
                        json=query)
    resp.raise_for_status()
    wanted = normalize_subject(subject)
    best, best_date = None, None          # même objet
    loose_best, loose_date = None, None   # même correspondant seulement
    for item in resp.json():
        doc = item.get('document')
        if not doc:
            continue
        fields = doc['fields']
        ts = fields.get('date', {}).get('timestampValue', '')
        if not ts or parse_ts(ts) > when:
            continue
        name = doc['name'].rsplit('/', 1)[-1]
        if normalize_subject(fields.get('subject', {}).get('stringValue', '')) == wanted:
            if best_date is None or parse_ts(ts) > best_date:
                best, best_date = name, parse_ts(ts)
        if loose and (when - parse_ts(ts)).days <= 90:
            if loose_date is None or parse_ts(ts) > loose_date:
                loose_best, loose_date = name, parse_ts(ts)
    return best or (loose_best if loose else None)


def append_to_thread(session, project, doc_id, entry, when, from_me):
    """Ajoute un message à l'historique du fil, sans doublon, et met à jour le statut et le dernier auteur."""
    resp = session.get(doc_url(project, doc_id))
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    fields = resp.json().get('fields', {})
    history = json.loads(fields.get('historique', {}).get('stringValue') or '[]')
    key = (entry['date'], entry['de'], entry['texte'][:80])
    if any((h.get('date'), h.get('de'), (h.get('texte') or '')[:80]) == key for h in history):
        return False
    if not history:  # premier échange : on y met le mail d'origine
        original = fields.get('date', {}).get('timestampValue', '')
        history.append({'date': parse_ts(original).strftime('%Y-%m-%d') if original else entry['date'],
                        'de': fields.get('from_name', {}).get('stringValue', '') or fields.get('from_email', {}).get('stringValue', ''),
                        'texte': (fields.get('texte', {}).get('stringValue') or fields.get('snippet', {}).get('stringValue') or '')[:500]})
    history.append(entry)
    current = fields.get('statut', {}).get('stringValue', 'nouveau')
    body = {'historique': {'stringValue': json.dumps(history, ensure_ascii=False)},
            'dernier_message': {'stringValue': 'vous' if from_me else 'client'},
            'dernier_message_at': {'timestampValue': when.strftime('%Y-%m-%dT%H:%M:%SZ')}}
    mask = ['historique', 'dernier_message', 'dernier_message_at']
    if from_me and current == 'nouveau':
        body['statut'] = {'stringValue': 'contacte'}; mask.append('statut')
    if not from_me and current == 'contacte':
        body['statut'] = {'stringValue': 'a_traiter'}; mask.append('statut')
    session.patch(doc_url(project, doc_id), params=[('updateMask.fieldPaths', m) for m in mask],
                  json={'fields': body}).raise_for_status()
    return True


def sync_sent(imap, session, project):
    """Rattache les réponses envoyées (dossier Envoyés) aux fils existants."""
    folder = find_sent_folder(imap)
    try:
        imap.select(folder, readonly=True)
    except imaplib.IMAP4.error as exc:
        print(f'dossier Envoyés introuvable ({folder}) : {exc}', flush=True)
        return 0
    _, data = imap.search(None, 'SINCE', SINCE)
    attached = 0
    own = os.environ.get('ORANGE_IMAP_USER', '').lower()
    for num in data[0].split():
        _, raw = imap.fetch(num, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID TO SUBJECT DATE IN-REPLY-TO REFERENCES)])')
        head = message_from_bytes(raw[0][1])
        _, to_email = parseaddr(header_text(head.get('To')))
        to_email = to_email.lower()
        if not to_email or to_email == own or to_email.endswith('@' + OWN_DOMAIN):
            continue
        when = parse_date(head.get('Date'))
        target = find_thread_doc(session, project, refs_of(head), to_email, header_text(head.get('Subject')), when, loose=True)
        if not target:
            continue
        full = fetch_full(imap, num)
        entry = {'date': when.strftime('%Y-%m-%d'), 'de': 'Jordan Vandaele', 'texte': new_text(full)}
        if entry['texte'] and append_to_thread(session, project, target, entry, when, from_me=True):
            attached += 1
    print(f'{attached} réponses envoyées rattachées aux fils', flush=True)
    return attached


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
            if not from_email or is_automatic(head, from_email):
                skipped += 1
                continue

            message_id = (head.get('Message-ID') or '').strip()
            fallback = '|'.join([head.get('From', ''), head.get('Date', ''), head.get('Subject', '')])
            doc_id = doc_id_for(message_id, fallback)

            if exists(session, project, doc_id):
                present += 1
                continue

            head_subject = header_text(head.get('Subject'))
            head_date = parse_date(head.get('Date')).strftime('%Y-%m-%dT%H:%M:%SZ')
            if already_imported(session, project, from_email, head_subject, head_date):
                present += 1  # même mail déjà présent (copie Gmail) : on ne le duplique pas
                continue

            if DRY_RUN:
                print(f'[dry-run] nouveau : {header_text(head.get("Subject"))}')
                created += 1
                continue

            full = fetch_full(imap, num)
            if is_advertising(header_text(full.get('Subject')), from_email, body_of(full)):
                skipped += 1  # publicité ou newsletter, lue dans le texte du mail
                continue
            when = parse_date(head.get('Date'))
            thread = find_thread_doc(session, project, refs_of(head), from_email, head_subject, when)
            if thread:
                entry = {'date': when.strftime('%Y-%m-%d'), 'de': from_name or from_email, 'texte': new_text(full)}
                if entry['texte']:
                    append_to_thread(session, project, thread, entry, when, from_me=False)
                present += 1  # réponse d'un client : ajoutée au fil existant, pas de nouvelle fiche
                continue
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
              f'{present} déjà présents · {skipped} ignorés (expéditeurs automatiques)', flush=True)
        imap.select('INBOX', readonly=True)
        sync_sent(imap, session, project)
    finally:
        imap.logout()


def sync_doc_url(project):
    return f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/{REQUEST_DOC}'


def parse_ts(value):
    if not value:
        return None
    # Firestore renvoie des fractions de seconde : on les retire avant de parser
    return datetime.fromisoformat(re.sub(r'\.\d+', '', value).replace('Z', '+00:00'))


def read_sync_state(session, project):
    resp = session.get(sync_doc_url(project))
    if resp.status_code == 404:
        return None, None
    resp.raise_for_status()
    fields = resp.json().get('fields', {})
    return (parse_ts(fields.get('requested_at', {}).get('timestampValue')),
            parse_ts(fields.get('last_done_at', {}).get('timestampValue')))


def write_sync_result(session, project, when, error=''):
    fields = {'last_done_at': {'timestampValue': when.strftime('%Y-%m-%dT%H:%M:%SZ')},
              'last_error': {'stringValue': error}}
    resp = session.patch(sync_doc_url(project),
                         params=[('updateMask.fieldPaths', 'last_done_at'), ('updateMask.fieldPaths', 'last_error')],
                         json={'fields': fields})
    resp.raise_for_status()


def needs_sync(requested, done):
    return requested is not None and (done is None or requested > done)


def watch():
    creds_info = json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT_JSON'])
    project = creds_info['project_id']
    session = AuthorizedSession(
        service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES))
    print('Mode surveillance : en attente d\'une demande depuis l\'admin.', flush=True)
    while True:
        try:
            requested, done = read_sync_state(session, project)
            if needs_sync(requested, done):
                print(f'{datetime.now():%H:%M:%S} demande reçue, synchro en cours…', flush=True)
                error = ''
                try:
                    main()
                except Exception as exc:  # on garde la boucle en vie et on note l'erreur
                    error = str(exc)[:300]
                    print('erreur synchro :', error, flush=True)
                write_sync_result(session, project, datetime.now(timezone.utc), error)
                print(f'{datetime.now():%H:%M:%S} synchro terminée.', flush=True)
        except Exception as exc:
            print('erreur surveillance :', exc, flush=True)
        time.sleep(WATCH_INTERVAL)


if __name__ == '__main__':
    if '--watch' in sys.argv:
        watch()
    else:
        main()
