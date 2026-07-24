import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function digestStreamSha256(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const hash = createHash("sha256");
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk as Buffer);
      callback();
    },
  });

  await pipeline(stream, sink);
  return `sha256:${hash.digest("hex")}`;
}
