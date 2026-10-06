/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/polaris.json`.
 */
export type Polaris = {
  "address": "HL4FgsM51RQQis74TwDkK733ZcTDnqWF8L772Y7tFVaA",
  "metadata": {
    "name": "polaris",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Polaris on Solana: pay now, Pay in 4 against an on-chain credit line, send by link, daily check-in with SKR rewards"
  },
  "instructions": [
    {
      "name": "cancelLink",
      "docs": [
        "The sender takes an unclaimed link back."
      ],
      "discriminator": [
        24,
        199,
        194,
        250,
        228,
        31,
        137,
        113
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "link.link_key",
                "account": "link"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "link.link_key",
                "account": "link"
              }
            ]
          }
        },
        {
          "name": "senderUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "checkIn",
      "docs": [
        "The daily loop: one check-in per UTC day. Builds a streak, pays SKR",
        "from the rewards vault (base x min(streak, 7)) and adds a score point",
        "(the first CHECKIN_SCORE_CAP of them)."
      ],
      "discriminator": [
        209,
        253,
        4,
        217,
        250,
        241,
        207,
        50
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "rewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "skrMint"
        },
        {
          "name": "userSkr",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "skrMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimLink",
      "docs": [
        "Claim a link. Signed by the link key, which also pays the fee and the",
        "recipient's token-account rent, so the recipient needs no SOL."
      ],
      "discriminator": [
        87,
        206,
        8,
        104,
        149,
        12,
        185,
        250
      ],
      "accounts": [
        {
          "name": "linkKey",
          "docs": [
            "The link key signs and pays: the recipient needs no SOL."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "link"
          ]
        },
        {
          "name": "recipient"
        },
        {
          "name": "sender",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "linkKey"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "linkKey"
              }
            ]
          }
        },
        {
          "name": "usdMint"
        },
        {
          "name": "recipientUsd",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "collectDue",
      "docs": [
        "Permissionless crank: collect a due instalment through the buyer's",
        "delegate approval. Fails if nothing is due yet."
      ],
      "discriminator": [
        141,
        16,
        26,
        246,
        90,
        209,
        175,
        176
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "plan.buyer",
                "account": "plan"
              }
            ]
          }
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "plan.buyer",
                "account": "plan"
              },
              {
                "kind": "account",
                "path": "plan.index",
                "account": "plan"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buyerUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createLink",
      "docs": [
        "Send by link: escrow dollars under an ephemeral link key. The secret",
        "of that key travels in the link; whoever holds it can claim."
      ],
      "discriminator": [
        103,
        114,
        207,
        84,
        216,
        71,
        234,
        61
      ],
      "accounts": [
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "linkKey",
          "docs": [
            "travels in the link and must sign the claim."
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "linkKey"
              }
            ]
          }
        },
        {
          "name": "usdMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  110,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "linkKey"
              }
            ]
          }
        },
        {
          "name": "senderUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expiresInSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "faucet",
      "docs": [
        "Devnet only: mint test dollars (pUSD) or stand-in SKR to the caller."
      ],
      "discriminator": [
        0,
        98,
        59,
        30,
        144,
        142,
        113,
        12
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "userToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundPool",
      "docs": [
        "Anyone can add dollars to the credit pool that funds Pay in 4."
      ],
      "discriminator": [
        36,
        57,
        233,
        176,
        181,
        20,
        87,
        159
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "from",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundRewards",
      "docs": [
        "Anyone can top up the SKR rewards vault the daily check-in pays from."
      ],
      "discriminator": [
        114,
        64,
        163,
        112,
        175,
        167,
        19,
        121
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "from",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initProfile",
      "docs": [
        "A buyer's credit record. Starts at STARTING_SCORE."
      ],
      "discriminator": [
        210,
        162,
        212,
        95,
        95,
        186,
        89,
        119
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Create the config and the three vaults. The two mints are passed in:",
        "on devnet they are stand-ins whose mint authority is the config PDA",
        "(so the faucet works); on mainnet they would be USDC and SKR."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdMint"
        },
        {
          "name": "skrMint"
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "skrVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "lockSkr",
      "docs": [
        "Lock SKR to raise the Pay in 4 limit (SKR as credit collateral)."
      ],
      "discriminator": [
        18,
        54,
        171,
        57,
        10,
        239,
        149,
        108
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "skrVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "userSkr",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openPlan",
      "docs": [
        "Pay in 4: the pool pays the merchant the full price now; the buyer owes",
        "four instalments (principal + 10% APR pro-rated), nothing due today.",
        "The buyer also approves the config PDA as delegate for what they owe,",
        "so a crank can collect due instalments (Solana's stand-in for the",
        "ERC-2612 permits and the CRE collections workflow on Monad)."
      ],
      "discriminator": [
        61,
        182,
        105,
        40,
        217,
        162,
        28,
        9
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchant.authority",
                "account": "merchant"
              }
            ]
          }
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "profile.plans_opened",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buyerUsd",
          "writable": true
        },
        {
          "name": "merchantUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "principal",
          "type": "u64"
        },
        {
          "name": "orderId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "pay",
      "docs": [
        "Pay now: dollars straight from the buyer to the merchant."
      ],
      "discriminator": [
        119,
        18,
        216,
        65,
        192,
        117,
        122,
        220
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchant.authority",
                "account": "merchant"
              }
            ]
          }
        },
        {
          "name": "buyerUsd",
          "writable": true
        },
        {
          "name": "merchantUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "orderId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "registerMerchant",
      "discriminator": [
        238,
        245,
        77,
        132,
        161,
        88,
        216,
        248
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "repayInstallment",
      "docs": [
        "The buyer pays their next instalment (early counts as on time)."
      ],
      "discriminator": [
        113,
        130,
        233,
        104,
        65,
        2,
        233,
        21
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true,
          "relations": [
            "plan"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "plan.index",
                "account": "plan"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buyerUsd",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "repayWithSkr",
      "docs": [
        "Pay the next instalment in SKR instead of dollars, at the config's SKR",
        "price. The SKR goes to the rewards vault, so what buyers spend funds",
        "the next day's check-in rewards. (On mainnet a treasury job would swap",
        "a share to USDC through Jupiter to refill the pool; not built.)"
      ],
      "discriminator": [
        176,
        201,
        140,
        120,
        103,
        224,
        94,
        166
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true,
          "relations": [
            "plan"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "plan.index",
                "account": "plan"
              }
            ]
          }
        },
        {
          "name": "rewards",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "userSkr",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "setParams",
      "docs": [
        "Admin: tune the knobs (pause new Pay in 4 plans, SKR price stand-in,",
        "instalment interval, grace, daily reward, faucet)."
      ],
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "unlockSkr",
      "docs": [
        "Unlock SKR, unless what stays locked would no longer cover the debt."
      ],
      "discriminator": [
        1,
        1,
        227,
        229,
        88,
        77,
        31,
        248
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "skrVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  114,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "userSkr",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "link",
      "discriminator": [
        90,
        57,
        179,
        207,
        13,
        91,
        161,
        190
      ]
    },
    {
      "name": "merchant",
      "discriminator": [
        71,
        235,
        30,
        40,
        231,
        21,
        32,
        64
      ]
    },
    {
      "name": "plan",
      "discriminator": [
        161,
        231,
        251,
        119,
        2,
        12,
        162,
        2
      ]
    },
    {
      "name": "profile",
      "discriminator": [
        184,
        101,
        165,
        188,
        95,
        63,
        127,
        188
      ]
    }
  ],
  "events": [
    {
      "name": "checkedIn",
      "discriminator": [
        211,
        80,
        198,
        244,
        196,
        84,
        212,
        150
      ]
    },
    {
      "name": "installmentPaid",
      "discriminator": [
        247,
        32,
        44,
        43,
        84,
        76,
        215,
        84
      ]
    },
    {
      "name": "linkCancelled",
      "discriminator": [
        172,
        145,
        167,
        209,
        76,
        111,
        16,
        243
      ]
    },
    {
      "name": "linkClaimed",
      "discriminator": [
        56,
        244,
        38,
        98,
        128,
        26,
        51,
        199
      ]
    },
    {
      "name": "linkCreated",
      "discriminator": [
        23,
        29,
        22,
        108,
        76,
        67,
        153,
        254
      ]
    },
    {
      "name": "merchantRegistered",
      "discriminator": [
        202,
        61,
        140,
        95,
        139,
        239,
        17,
        83
      ]
    },
    {
      "name": "paid",
      "discriminator": [
        240,
        193,
        17,
        238,
        238,
        210,
        129,
        235
      ]
    },
    {
      "name": "paramsSet",
      "discriminator": [
        57,
        111,
        33,
        252,
        120,
        76,
        98,
        245
      ]
    },
    {
      "name": "planOpened",
      "discriminator": [
        180,
        40,
        139,
        132,
        248,
        34,
        213,
        58
      ]
    },
    {
      "name": "skrLocked",
      "discriminator": [
        149,
        235,
        3,
        68,
        48,
        105,
        243,
        178
      ]
    },
    {
      "name": "skrSpent",
      "discriminator": [
        140,
        143,
        49,
        100,
        209,
        170,
        101,
        104
      ]
    },
    {
      "name": "skrUnlocked",
      "discriminator": [
        151,
        54,
        98,
        232,
        117,
        20,
        188,
        59
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badParams",
      "msg": "Parameters out of range"
    },
    {
      "code": 6001,
      "name": "faucetDisabled",
      "msg": "The faucet is off on this network"
    },
    {
      "code": 6002,
      "name": "faucetCap",
      "msg": "Faucet amount above the per-call cap"
    },
    {
      "code": 6003,
      "name": "wrongMint",
      "msg": "Not one of Polaris' mints"
    },
    {
      "code": 6004,
      "name": "wrongVault",
      "msg": "Not the vault this instruction funds"
    },
    {
      "code": 6005,
      "name": "badName",
      "msg": "Merchant name must be 1-32 bytes"
    },
    {
      "code": 6006,
      "name": "zeroAmount",
      "msg": "Amount must be above zero"
    },
    {
      "code": 6007,
      "name": "creditPaused",
      "msg": "New Pay in 4 plans are paused"
    },
    {
      "code": 6008,
      "name": "planTooSmall",
      "msg": "Pay in 4 starts at $1"
    },
    {
      "code": 6009,
      "name": "overLimit",
      "msg": "Above your Pay in 4 limit"
    },
    {
      "code": 6010,
      "name": "poolShort",
      "msg": "The credit pool is short"
    },
    {
      "code": 6011,
      "name": "planClosed",
      "msg": "This plan is paid off"
    },
    {
      "code": 6012,
      "name": "notDue",
      "msg": "Nothing is due yet"
    },
    {
      "code": 6013,
      "name": "alreadyCheckedIn",
      "msg": "Already clocked in today"
    },
    {
      "code": 6014,
      "name": "collateralInUse",
      "msg": "That SKR backs what you owe"
    },
    {
      "code": 6015,
      "name": "badExpiry",
      "msg": "Expiry must be within 60 days"
    },
    {
      "code": 6016,
      "name": "linkExpired",
      "msg": "This link has expired"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "checkedIn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "day",
            "type": "i64"
          },
          {
            "name": "streak",
            "type": "u16"
          },
          {
            "name": "reward",
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdMint",
            "type": "pubkey"
          },
          {
            "name": "skrMint",
            "type": "pubkey"
          },
          {
            "name": "intervalSecs",
            "type": "i64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "skrPriceMicros",
            "type": "u64"
          },
          {
            "name": "skrCollateralBps",
            "type": "u16"
          },
          {
            "name": "checkinReward",
            "type": "u64"
          },
          {
            "name": "creditPaused",
            "type": "bool"
          },
          {
            "name": "faucetEnabled",
            "type": "bool"
          },
          {
            "name": "planCount",
            "type": "u64"
          },
          {
            "name": "totalOriginated",
            "type": "u64"
          },
          {
            "name": "totalOutstanding",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "poolBump",
            "type": "u8"
          },
          {
            "name": "rewardsBump",
            "type": "u8"
          },
          {
            "name": "skrVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "intervalSecs",
            "type": "i64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "skrPriceMicros",
            "docs": [
              "USD price of 1 SKR in micro-dollars. Stand-in for an oracle feed."
            ],
            "type": "u64"
          },
          {
            "name": "skrCollateralBps",
            "docs": [
              "Share of locked SKR's value that counts toward the limit (bps)."
            ],
            "type": "u16"
          },
          {
            "name": "checkinReward",
            "docs": [
              "SKR paid for a check-in at streak 1 (base units)."
            ],
            "type": "u64"
          },
          {
            "name": "creditPaused",
            "type": "bool"
          },
          {
            "name": "faucetEnabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "installmentPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "installment",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "onTime",
            "type": "bool"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "link",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "linkKey",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "linkCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "linkKey",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "linkClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "linkKey",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "linkCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "linkKey",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "merchant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "totalSettled",
            "type": "u64"
          },
          {
            "name": "payments",
            "type": "u32"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchantRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchant",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "paid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "orderId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "score",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "paramsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creditPaused",
            "type": "bool"
          },
          {
            "name": "skrPriceMicros",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "plan",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "totalOwed",
            "type": "u64"
          },
          {
            "name": "repaid",
            "type": "u64"
          },
          {
            "name": "installments",
            "type": "u8"
          },
          {
            "name": "paid",
            "type": "u8"
          },
          {
            "name": "startedAt",
            "type": "i64"
          },
          {
            "name": "intervalSecs",
            "type": "i64"
          },
          {
            "name": "orderId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "planOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "totalOwed",
            "type": "u64"
          },
          {
            "name": "firstDue",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "profile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "activeDebt",
            "type": "u64"
          },
          {
            "name": "plansOpened",
            "type": "u32"
          },
          {
            "name": "plansRepaid",
            "type": "u32"
          },
          {
            "name": "onTime",
            "type": "u32"
          },
          {
            "name": "late",
            "type": "u32"
          },
          {
            "name": "payments",
            "type": "u32"
          },
          {
            "name": "skrLocked",
            "type": "u64"
          },
          {
            "name": "skrEarned",
            "type": "u64"
          },
          {
            "name": "streak",
            "type": "u16"
          },
          {
            "name": "bestStreak",
            "type": "u16"
          },
          {
            "name": "lastCheckInDay",
            "type": "i64"
          },
          {
            "name": "checkIns",
            "type": "u32"
          },
          {
            "name": "checkinPoints",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "skrLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "locked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "skrSpent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "skr",
            "type": "u64"
          },
          {
            "name": "usdValue",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "skrUnlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "locked",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
