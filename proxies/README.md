# proxies/

Local proxies the harness depends on, kept in this repo so the CLI, the desktop app and the
proxy are built, tested and versioned together.

| Folder | What | Upstream | hcodex provider |
|---|---|---|---|
| `fusebox/` | OpenAI / Claude / Gemini compatible proxy over personal accounts (Rust) | [DigitalPals/Fusebox](https://github.com/DigitalPals/Fusebox), MIT | `hibox` (`http://127.0.0.1:8317/v1`) |

`fusebox/` is the upstream tree plus this repo's own commits on top; its `LICENSE` and `NOTICE`
are the upstream ones. `fusebox.upstream` records the upstream release the tree is based on.

Everything goes through one script:

```bash
scripts/fusebox.sh status         # service, versions (installed / source), models served
scripts/fusebox.sh build          # cargo build --release in proxies/fusebox
scripts/fusebox.sh install        # build, back up the installed binary, replace it, restart, check; rolls back if it does not answer
scripts/fusebox.sh rollback       # put the backed-up binary back
scripts/fusebox.sh sync --check   # is there a newer upstream release?
scripts/fusebox.sh sync [tag]     # apply the upstream changes since the recorded release (3-way), leave them staged
```

Config, accounts and usage data stay outside the repo in `~/.fusebox/`; nothing in there is
ever committed.
