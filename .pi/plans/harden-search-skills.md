# Harden Search Skills

## Context
Live checks found: Lazada bridge missing, Telegram points at a nonexistent private venv, HomePro search endpoint returns 403, Gmail token is revoked, and most parsers have no fixture tests. Browser work must not touch the owner's active tabs or focus.

## Approach
Add deterministic offline health/tests first, then self-heal session-dependent adapters, make failures actionable, and perform bounded live smoke tests only after the code is safe.

## Tasks

### Task 1: Baseline health framework and parser fixtures
**Files:** `tests/run.sh`, `tests/test_units.py`, `tests/fixtures/*`, skill scripts
**Acceptance:** offline test suite covers Shopee vitem/price parsing, Lazada output parsing, Telegram formatter, and bridge invariants.
**Verify:** `./tests/run.sh`

### Task 2: Harden Lazada bridge recovery
**Files:** `skills/lazada/scripts/*.cjs`, `skills/lazada/SKILL.md`
**Depends:** Task 1
**Acceptance:** missing/stale bridge state self-heals once using the same protected background-window helper; no owner tab or focus is touched.
**Verify:** offline bridge tests + bounded live search.

### Task 3: Repair Telegram runtime discovery
**Files:** `skills/telegram-search/scripts/tg-search.sh`, `skills/telegram-search/SKILL.md`
**Depends:** Task 1
**Acceptance:** auto-discovers the documented local tg_agent checkout/venv/session and produces a clear auth/runtime diagnostic.
**Verify:** offline tests + bounded live search.

### Task 4: Restore HomePro or provide robust fallback
**Files:** HomePro skill scripts/docs and tests
**Depends:** Task 1
**Acceptance:** search either returns current products from a supported source or exits nonzero with a truthful anti-bot diagnostic; never silently returns zero on HTTP 403.
**Verify:** fixtures + bounded live query.

### Task 5: Make Gmail OAuth failure recoverable
**Files:** Gmail skill script/docs
**Acceptance:** revoked token prints one concise re-auth command rather than a traceback; auth flow preserves read/draft-only permissions.
**Verify:** unit test with mocked RefreshError; `--help`; owner completes OAuth separately.

### Task 6: Full verification and status report
**Depends:** Tasks 2–5
**Acceptance:** offline suite green; live smoke status recorded without claiming unverified integrations are healthy.
**Verify:** `./tests/run.sh`, bounded smoke test matrix, secret/path scan.

## Verification
- [ ] All offline tests pass
- [ ] No secrets or private machine paths enter tracked files
- [ ] Browser helpers preserve owner focus/tabs
- [ ] Each live adapter has `health` or actionable nonzero failure
- [ ] No message, purchase, cart mutation, email draft, or post is created
