import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";
import { deriveEvmKey } from "./derive";

/**
 * The Mera path: Face ID → PRF (32 bytes) → secp256k1 key → viem account.
 * This is the entire account layer. There is no seed phrase to write down,
 * no extension, and no server that holds a key.
 */

export type OpenedSession = {
  account: LocalAccount;
  /** Zeroes the signing key. Signing afterwards throws SESSION_ENDED. */
  end: () => void;
  credentialId: string;
  transports?: readonly string[];
};

/** PRF output → a live signing session. The caller's copies are wiped. */
function openSession(prfOutput: Uint8Array): Pick<OpenedSession, "account" | "end"> {
  const privateKey = deriveEvmKey(prfOutput);
  try {
    const session = createSecp256k1SigningSession({ privateKey });
    return { account: toViemAccount(session), end: () => session.end() };
  } finally {
    privateKey.fill(0);
    prfOutput.fill(0);
  }
}

/**
 * Creates a NEW passkey, and so a NEW account. Every call adds one: call it
 * only from an explicit click, never from an effect (StrictMode runs effects
 * twice in dev, and two creates are two accounts).
 */
export async function meraCreate(rpId: string): Promise<OpenedSession> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "Polaris" },
    user: {
      name: "Polaris",
      // Shown in the system picker; the date keeps several apart.
      displayName: `Polaris account (${new Date().toLocaleDateString()})`,
    },
  });
  const { account, end } = openSession(created.prfOutput);
  return {
    account,
    end,
    credentialId: created.credentialId,
    ...(created.transports ? { transports: created.transports } : {}),
  };
}

/**
 * Signs back in to an existing account. With `credential`, Face ID goes
 * straight to that passkey; without it, the system shows every Polaris
 * passkey on the device (a new phone, the other subdomain, an installed app).
 */
export async function meraSignIn(rpId: string, credential?: PasskeyCredentialMetadata): Promise<OpenedSession> {
  const { credentialId, prfOutput } = await getPasskeyPrfOutput({
    rpId,
    ...(credential ? { credential } : {}),
  });
  const { account, end } = openSession(prfOutput);
  return { account, end, credentialId };
}
