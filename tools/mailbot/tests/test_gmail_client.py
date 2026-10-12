from fakes import FakeService, b64, make_msg

from mailbot.gmail_client import GmailClient, get_header


def client(svc):
    return GmailClient("credentials.json", "token.json", service=svc)


def test_search_paginates_until_no_token():
    svc = FakeService(pages={
        None: {"messages": [{"id": "a"}, {"id": "b"}], "nextPageToken": "p2"},
        "p2": {"messages": [{"id": "c"}]},
    })
    assert client(svc).search("q") == ["a", "b", "c"]
    lists = [kw for name, kw in svc.calls if name == "messages.list"]
    assert lists[0]["q"] == "q" and lists[0]["userId"] == "me"
    assert lists[1]["pageToken"] == "p2"


def test_search_respects_max_results():
    svc = FakeService(pages={
        None: {"messages": [{"id": "a"}, {"id": "b"}], "nextPageToken": "p2"},
        "p2": {"messages": [{"id": "c"}]},
    })
    assert client(svc).search("q", max_results=2) == ["a", "b"]


def test_search_empty_result():
    assert client(FakeService(pages={None: {"resultSizeEstimate": 0}})).search("q") == []


def test_get_message_uses_full_format_and_headers():
    svc = FakeService(messages={"m1": make_msg("m1", "對帳單", "x@bank.tw")})
    msg = client(svc).get_message("m1")
    assert ("messages.get", {"userId": "me", "id": "m1", "format": "full"}) in svc.calls
    assert get_header(msg, "subject") == "對帳單"
    assert get_header(msg, "From") == "x@bank.tw"
    assert get_header(msg, "Date") == ""


def test_get_attachment_decodes_urlsafe_b64_without_padding():
    raw = b"%PDF-\xff\xfe\xfd binary?"
    svc = FakeService(attachments={"att": b64(raw)})
    assert client(svc).get_attachment("m1", "att") == raw


def test_ensure_label_returns_existing():
    svc = FakeService(labels=[{"id": "X1", "name": "已記帳"}])
    assert client(svc).ensure_label("已記帳") == "X1"
    assert not any(n == "labels.create" for n, _ in svc.calls)


def test_ensure_label_creates_missing_and_caches():
    svc = FakeService(labels=[{"id": "X1", "name": "other"}])
    c = client(svc)
    lid = c.ensure_label("記帳失敗")
    assert lid == "L2"
    assert c.ensure_label("記帳失敗") == "L2"
    assert sum(1 for n, _ in svc.calls if n == "labels.create") == 1


def test_add_label_modifies_message():
    svc = FakeService()
    client(svc).add_label("m1", "X1")
    assert ("messages.modify", {"userId": "me", "id": "m1", "body": {"addLabelIds": ["X1"]}}) in svc.calls


def test_token_path_defaults_next_to_credentials(tmp_path):
    c = GmailClient(str(tmp_path / "credentials.json"), service=FakeService())
    assert c.token_path == str(tmp_path / "token.json")
