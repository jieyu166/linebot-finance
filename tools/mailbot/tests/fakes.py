"""Fake Gmail API service + fake GmailClient for tests."""
import base64


class _Req:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeMessages:
    def __init__(self, svc):
        self.svc = svc

    def list(self, **kw):
        self.svc.calls.append(("messages.list", kw))
        return _Req(lambda: self.svc.pages[kw.get("pageToken")])

    def get(self, **kw):
        self.svc.calls.append(("messages.get", kw))
        return _Req(lambda: self.svc.messages[kw["id"]])

    def modify(self, **kw):
        self.svc.calls.append(("messages.modify", kw))
        return _Req(lambda: {})

    def attachments(self):
        svc = self.svc

        class A:
            def get(self, **kw):
                svc.calls.append(("attachments.get", kw))
                return _Req(lambda: {"data": svc.attachments[kw["id"]]})

        return A()


class FakeLabels:
    def __init__(self, svc):
        self.svc = svc

    def list(self, **kw):
        self.svc.calls.append(("labels.list", kw))
        return _Req(lambda: {"labels": list(self.svc.labels)})

    def create(self, **kw):
        self.svc.calls.append(("labels.create", kw))

        def run():
            lab = {"id": f"L{len(self.svc.labels) + 1}", "name": kw["body"]["name"]}
            self.svc.labels.append(lab)
            return lab

        return _Req(run)


class FakeUsers:
    def __init__(self, svc):
        self.svc = svc

    def messages(self):
        return FakeMessages(self.svc)

    def labels(self):
        return FakeLabels(self.svc)


class FakeService:
    def __init__(self, pages=None, messages=None, attachments=None, labels=None):
        self.pages = pages or {None: {}}
        self.messages = messages or {}
        self.attachments = attachments or {}
        self.labels = labels or []
        self.calls = []

    def users(self):
        return FakeUsers(self)


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_msg(mid, subject, sender="bank@example.com", pdfs=()):
    parts = [{"mimeType": "text/plain", "filename": "", "body": {"size": 1}}]
    for i, name in enumerate(pdfs):
        parts.append({"mimeType": "application/pdf", "filename": name,
                      "body": {"attachmentId": f"{mid}-att{i}"}})
    return {
        "id": mid,
        "payload": {
            "headers": [{"name": "Subject", "value": subject}, {"name": "From", "value": sender}],
            "parts": parts,
        },
    }


class FakeClient:
    """Stands in for GmailClient in processor tests."""

    def __init__(self, messages=None, attachments=None, search_ids=None):
        self.messages = messages or {}
        self.attachments = attachments or {}
        self.search_ids = search_ids if search_ids is not None else list(self.messages)
        self.queries = []
        self.added = []
        self.ensured = []

    def search(self, query, max_results=100):
        self.queries.append(query)
        return list(self.search_ids)

    def get_message(self, mid):
        return self.messages[mid]

    def get_attachment(self, mid, att_id):
        return self.attachments[att_id]

    def ensure_label(self, name):
        self.ensured.append(name)
        return "ID-" + name

    def add_label(self, mid, label_id):
        self.added.append((mid, label_id))
