# CRE runs on 2026-09-28

Each row is one `cre workflow simulate --broadcast` run (CRE CLI v1.35.0), with its log in this folder and its transaction read back from Monad testnet. "Delivered" is the forwarder's ReportProcessed result for the receiver.

| When (UTC) | Workflow | Target | Outcome | Transaction | Block | Delivered |
|---|---|---|---|---|---:|---|
| 2026-09-28 08:16:20 | collections-retry | staging-settings | written; log trigger: Reauthorized by 0xd1C7858FCAcD8440c84daef461A91BC15352d667; 1 task(s): collect #1; 1 executed, 0 skipped | [0x1116fbb4…292c4d](https://testnet.monadscan.com/tx/0x1116fbb4b53263776da4c5cc6d7984b66f1d31ac81f35215b5dcf246f1292c4d) | 66359311 | result=true |
| 2026-09-28 08:16:43 | collections | staging-settings | written; 2 task(s): collect #1, liquidate #1; 2 executed, 0 skipped; candidates: chain | [0xd7bcf41e…1a97e4](https://testnet.monadscan.com/tx/0xd7bcf41e8efa7841c86870689a3c9599c3a960d39f4c28b82c6980dc1f1a97e4) | 66359350 | result=true |
| 2026-09-28 08:16:56 | underwriting | staging-settings | failed: ✗ validation error | none |  |  |
| 2026-09-28 08:16:57 | guardian | staging-settings | written (first); healthy; round 1; AUSD/USD 0.99982194 (chainlink) | [0x015bd95d…3f9080](https://testnet.monadscan.com/tx/0x015bd95da145efb4884ea0e50730728a2023a15f890f737847ede4064e3f9080) | 66359401 | result=true |
| 2026-09-28 08:19:53 | underwriting | staging-settings | failed: ✗ validation error | none |  |  |
| 2026-09-28 08:22:25 | underwriting | staging-settings | incomplete; not final: account.firstSeenAt,account.sentCount | none |  |  |
