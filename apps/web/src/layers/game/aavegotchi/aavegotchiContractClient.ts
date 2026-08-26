import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { AAVEGOTCHI_DIAMOND } from "./aavegotchiConfig";

const abi = [
  {
    inputs: [{ name: "_tokenId", type: "uint256" }],
    name: "getAavegotchiSvg",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

const client = createPublicClient({ chain: base, transport: http() });

export async function fetchAavegotchiSvg(tokenId: string): Promise<string | null> {
  try {
    const svg = await client.readContract({
      address: AAVEGOTCHI_DIAMOND,
      abi,
      functionName: "getAavegotchiSvg",
      args: [BigInt(tokenId)]
    });
    return typeof svg === "string" && svg.length > 10 ? svg : null;
  } catch {
    return null;
  }
}
