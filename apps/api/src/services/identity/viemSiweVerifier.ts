import { getAddress, verifyMessage, type Hex } from "viem";
import type { SiweSignatureVerifier } from "./identityService.js";

/**
 * Local ERC-191 verifier for externally owned accounts. Contract-account (ERC-1271) verification
 * needs a chain-specific RPC client and remains an explicit capability gate, never a silent pass.
 */
export class ViemEoaSiweVerifier implements SiweSignatureVerifier {
  readonly id = "viem-eip191-eoa";

  async verify(input: {
    address: string;
    chainId: number;
    message: string;
    signature: string;
  }): Promise<boolean> {
    try {
      return await verifyMessage({
        address: getAddress(input.address),
        message: input.message,
        signature: input.signature as Hex
      });
    } catch {
      return false;
    }
  }
}
