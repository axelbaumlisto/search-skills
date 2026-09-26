from listing_monitor import tg
from listing_monitor.config import load_config


def test_env_file_from_config_feeds_telegram_creds(tmp_path, monkeypatch):
    for k in ("TG_API_ID", "TG_API_HASH", "TELEGRAM_API_ID", "TELEGRAM_API_HASH"):
        monkeypatch.delenv(k, raising=False)
    env = tmp_path / "creds.env"
    env.write_text("TELEGRAM_API_ID=123\nTELEGRAM_API_HASH=abc\nOTHER=1\n")
    cfg = tmp_path / "c.toml"
    cfg.write_text(f'name="t"\nmax_price_vnd=1\nmin_bedrooms=1\ncity_keywords=[]\nenv_file="{env}"\n')
    load_config(cfg)
    assert tg.credentials() == (123, "abc")


def test_repo_style_names_win(monkeypatch):
    monkeypatch.setenv("TG_API_ID", "7")
    monkeypatch.setenv("TG_API_HASH", "h")
    assert tg.credentials() == (7, "h")


def test_remote_path_expands_home_on_remote_side():
    from listing_monitor.remote import remote_path
    assert remote_path("~/a b/x.py") == "\"$HOME\"/'a b/x.py'"
    assert remote_path("/opt/x.py") == "/opt/x.py"
