// Seeker detection, read-only. The Seeker Genesis Token (SGT) exists only on
// mainnet, so this reads mainnet (no transactions); on an emulator or another
// phone it simply finds nothing. The device model check is a UI hint only.
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SGT_GROUP = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";

export async function findSgtMint(owner: PublicKey): Promise<string | null> {
  const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const { value } = await mainnet.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022 });
  const mints = value
    .map((a) => (a.account.data as any).parsed.info)
    .filter((i) => i.tokenAmount.amount !== "0" && i.tokenAmount.decimals === 0)
    .map((i) => new PublicKey(i.mint));
  for (let k = 0; k < mints.length; k += 100) {
    const infos = await mainnet.getMultipleParsedAccounts(mints.slice(k, k + 100));
    for (let j = 0; j < infos.value.length; j++) {
      const ext = (infos.value[j]?.data as any)?.parsed?.info?.extensions ?? [];
      const mp = ext.find((e: any) => e.extension === "metadataPointer")?.state?.metadataAddress;
      const gm = ext.find((e: any) => e.extension === "tokenGroupMember")?.state?.group;
      if (mp === SGT_GROUP && gm === SGT_GROUP) return mints[k + j].toBase58();
    }
  }
  return null;
}

export function useSeeker(owner: PublicKey | null) {
  const device = Platform.OS === "android" && (Platform.constants as any)?.Model === "Seeker";
  const [sgt, setSgt] = useState<string | null>(null);
  useEffect(() => {
    if (!owner) return;
    findSgtMint(owner).then(setSgt).catch(() => setSgt(null));
  }, [owner?.toBase58()]);
  return { device, verified: !!sgt, sgtMint: sgt };
}
