# CRE evidence

What real `cre workflow simulate` runs of Polaris's workflows left behind, as
the CLI printed it (secrets redacted), with every transaction read back from
Monad testnet. Nothing here is written by hand.

| Folder | Written by | What |
|---|---|---|
| `<UTC date>/` | `pnpm --filter @polaris/cre-workflows evidence` | One `simulate --broadcast` run per workflow: `<workflow>-<time>.log`, `runs.json`, `README.md` (the table: outcome, transaction, block, the forwarder's `ReportProcessed` result), `supported-chains.txt` |
| `loop/` | `pnpm --filter @polaris/cre-workflows collections:loop` | `polaris-collections` every minute for the demo: `<date>.log` (each run's output) and `<date>.jsonl` (one line per run: outcome, tasks, what the dunning ladder held back, transaction) |

A run that sent nothing (nothing due, a thin file, a dry run) is recorded as
such. How the scripts work, and what they refuse to do, is in
[`../README.md`](../README.md#the-evidence-in-one-command).
