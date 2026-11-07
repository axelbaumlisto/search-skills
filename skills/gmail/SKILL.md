---
name: gmail
description: 'Read Gmail and prepare drafts: search with Gmail syntax, open messages, list labels, download attachments, and create drafts. The skill intentionally has no send command or Gmail API send call.'
---

# Gmail: read + drafts, no send implementation

The script requests `gmail.modify` and `gmail.settings.basic`, has no `send`
command and contains no Gmail API send call: delivery through this skill is impossible
without changing its source. Important nuance: Google defines `gmail.modify` broadly;
the safety boundary is the audited code, not the absence of a separately named scope.

## Private configuration

Nothing private belongs in this repository. Defaults:

```text
~/.config/pi-skills/gmail/credentials.json   OAuth installed-app client
~/.config/pi-skills/gmail/token.json         generated token, mode 600
```

Overrides:

```bash
export GMAIL_OAUTH_CLIENT=/private/path/credentials.json
export GMAIL_TOKEN_FILE=/private/path/token.json
```

Dependencies: `google-api-python-client`, `google-auth-oauthlib`.

## Commands

```bash
G="python3 ~/.pi/agent/skills/gmail/scripts/gmail.py"
$G auth                         # prints consent URL; does not open a browser
$G auth '<one-time-code>'       # atomically writes token mode 600
$G labels
$G search "in:inbox is:unread" -n 10
$G read <message-id>
$G files <message-id> --save ./attachments
$G draft --to person@example.com --subject "Subject" --body "Text" --attach file.pdf
$G draft-reply <message-id> --body "Text" --attach file.pdf
$G drafts
$G archive "older:2025/01/01"                  # dry-run
$G archive "older:2025/01/01" --yes --label Archive
```

## Safety rules

- Never create or modify a draft unless the operator explicitly asks.
- `draft-reply` addresses the sender of the selected message. If the selected
  message was sent by the owner, determine the real recipient explicitly instead.
- Before claiming a draft is correct, read it back and verify `To`, subject,
  thread, body and attachment names.
- HTML mail is sanitized: `style`, `script`, and `head` are removed before tags.
- Revoked OAuth exits with one actionable line (`gmail.py auth`), not a traceback.
- No permanent deletion exists. `archive --trash` only moves mail to Trash.
- Offline tests fail if a `send` subcommand or Gmail API send call is introduced.
