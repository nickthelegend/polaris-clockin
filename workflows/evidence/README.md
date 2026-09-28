# CRE evidence

What real `cre workflow simulate` runs of Polaris's workflows left behind, as
the CLI printed it (secrets redacted), with every transaction read back from
Monad testnet. Nothing here is written by hand.

| Folder | Written by | What |
|---|---|---|
| `<UTC date>/` | `pnpm --filter @polaris/cre-workflows evidence` (`--retry-tx <hash>` adds the log trigger) | One `simulate --broadcast` run per workflow (collections, underwriting, guardian) and `collections-retry` for collections' EVM log trigger on a real `reauthorize`: `<run>-<time>.log`, `runs.json`, `README.md` (the table: outcome, transaction, block, the forwarder's `ReportProcessed` result), `supported-chains.txt` |
| `loop/` | `collections:loop`, `guardian:loop`, `retry:listen` | `polaris-collections` every minute for the demo: `<date>.log` (each run's output) and `<date>.jsonl` (one line per run: outcome, tasks, what the dunning ladder held back, transaction); `polaris-guardian` in `<date>-guardian.log` / `.jsonl` (the verdict, the round written); the live log trigger in `<date>-retry.log` / `.jsonl` |

A run that sent nothing (nothing due, a thin file, a guardian with nothing
new to attest, a dry run) is recorded as such. A run whose config differed
from the committed one (underwriting without the providers that had no key,
or a `--callback` URL) says so in its log's header and in `runs.json`
(`configChanges`). The `.log` files are committed: the root `.gitignore`
excepts `workflows/evidence/**/*.log` from its `*.log` rule, and `evidence`
warns if git would ignore anything it wrote. How the scripts work, and what
they refuse to do, is in
[`../README.md`](../README.md#the-evidence-in-one-command).
