"""Thin wrapper around the Gmail API (read messages/attachments, manage labels)."""
from __future__ import annotations

import base64
import os

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]


def get_header(msg: dict, name: str) -> str:
    """Case-insensitive header lookup on a Gmail `format=full` message."""
    for h in (msg.get("payload") or {}).get("headers") or []:
        if (h.get("name") or "").lower() == name.lower():
            return h.get("value") or ""
    return ""


class GmailClient:
    def __init__(self, credentials_path, token_path=None, scopes=None, service=None):
        self.credentials_path = str(credentials_path)
        self.token_path = str(token_path) if token_path else os.path.join(
            os.path.dirname(self.credentials_path), "token.json")
        self.scopes = list(scopes or DEFAULT_SCOPES)
        self._service = service
        self._label_cache: dict[str, str] = {}

    # --- auth -------------------------------------------------------------
    def build_service(self):
        """Run the installed-app OAuth flow if needed; persist token.json."""
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build

        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, self.scopes)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self.credentials_path, self.scopes)
                creds = flow.run_local_server(port=0)
            with open(self.token_path, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
        self._service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        return self._service

    @property
    def service(self):
        if self._service is None:
            self.build_service()
        return self._service

    # --- messages ---------------------------------------------------------
    def search(self, query: str, max_results: int = 100) -> list[str]:
        ids: list[str] = []
        token = None
        while len(ids) < max_results:
            kw = {"userId": "me", "q": query, "maxResults": min(500, max_results - len(ids))}
            if token:
                kw["pageToken"] = token
            resp = self.service.users().messages().list(**kw).execute()
            ids.extend(m["id"] for m in resp.get("messages") or [])
            token = resp.get("nextPageToken")
            if not token:
                break
        return ids[:max_results]

    def get_message(self, msg_id: str) -> dict:
        return self.service.users().messages().get(userId="me", id=msg_id, format="full").execute()

    def get_attachment(self, msg_id: str, att_id: str) -> bytes:
        resp = self.service.users().messages().attachments().get(
            userId="me", messageId=msg_id, id=att_id).execute()
        data = resp.get("data") or ""
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))

    # --- labels -----------------------------------------------------------
    def ensure_label(self, name: str) -> str:
        if name in self._label_cache:
            return self._label_cache[name]
        resp = self.service.users().labels().list(userId="me").execute()
        for lab in resp.get("labels") or []:
            if lab.get("name") == name:
                self._label_cache[name] = lab["id"]
                return lab["id"]
        created = self.service.users().labels().create(userId="me", body={
            "name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show",
        }).execute()
        self._label_cache[name] = created["id"]
        return created["id"]

    def add_label(self, msg_id: str, label_id: str) -> None:
        self.service.users().messages().modify(
            userId="me", id=msg_id, body={"addLabelIds": [label_id]}).execute()
