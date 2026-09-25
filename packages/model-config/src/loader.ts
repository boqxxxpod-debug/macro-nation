import type { ParsedConfigPack, ConfigPackInput } from "./schemas";
import { verifyConfigPackHashes } from "./snapshot";
import { parseConfigPack } from "./validation";

/**
 * Parse a ConfigPack and verify every manifest-pinned file before it is used.
 * Headless runners and application composition roots should use this loader.
 */
export async function loadConfigPack(
  input: ConfigPackInput,
  files: Readonly<Record<string, unknown>>,
): Promise<ParsedConfigPack> {
  const pack = parseConfigPack(input);
  await verifyConfigPackHashes(pack, files);
  return pack;
}
