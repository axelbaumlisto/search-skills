from datetime import datetime, timezone

from listing_monitor.models import Listing
from listing_monitor.pipeline import refresh
from listing_monitor.store import State


def mk(url, **kw):
    d = dict(source="chotot", url=url, title="Cho thuê nhà", text="Cho thuê nhà Phú Quốc", price_vnd=6_000_000,
             bedrooms=2, kind="rent")
    d.update(kw)
    return Listing(**d)


def test_refresh_sends_only_new_matching(cfg, tmp_path):
    cfg.state_path, cfg.master_path = tmp_path / "s.json", tmp_path / "m.md"
    State(cfg.state_path, seen={"old"}).save()
    sent = []
    sources = {
        "chotot": lambda c, since: [mk("old"), mk("new-ok"), mk("new-expensive", price_vnd=30_000_000)],
        "telegram": lambda c, since: (_ for _ in ()).throw(RuntimeError("session dead")),
    }
    res = refresh(cfg, sources=sources, send=sent.append, now=datetime(2026, 9, 26, 12, tzinfo=timezone.utc))

    assert [x.url for x in res.matched] == ["new-ok"]
    assert len(sent) == 1 and "new-ok" in sent[0]
    assert "telegram: ошибка" in res.stats
    st = State.load(cfg.state_path)
    assert {"new-ok", "new-expensive", "old"} <= st.seen and st.sent == {"new-ok"}
    assert "new-ok" in cfg.master_path.read_text()

    # повторный запуск — ничего нового, ничего не отправлено
    res2 = refresh(cfg, sources={"chotot": sources["chotot"]}, send=sent.append)
    assert res2.matched == [] and len(sent) == 1
    assert "новых подходящих нет" in cfg.master_path.read_text()


def test_refresh_dry_run_changes_nothing(cfg, tmp_path):
    cfg.state_path, cfg.master_path = tmp_path / "s.json", tmp_path / "m.md"
    sent = []
    res = refresh(cfg, sources={"chotot": lambda c, s: [mk("x")]}, send=sent.append, dry_run=True)
    assert [x.url for x in res.matched] == ["x"]
    assert sent == [] and not cfg.state_path.exists() and not cfg.master_path.exists()


def test_registry_follows_config(cfg):
    from listing_monitor.pipeline import default_sources
    assert set(default_sources(cfg)) == {"chotot", "facebook", "telegram", "muaban"}
    cfg.muaban = {}
    assert "muaban" not in default_sources(cfg)
