import { Writable } from "node:stream";

import { collectSkillEntries, createTarStream } from "./tar.js";
import { resolveSkillDir } from "./paths.js";

async function pipeToWritable(
  stream: NodeJS.ReadableStream,
  dest: Writable,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onEnd = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
      dest.removeListener("error", onError);
    };

    stream.on("error", onError);
    stream.on("end", onEnd);
    dest.on("error", onError);

    stream.pipe(dest, { end: false });
  });
}

export async function exportSkill(
  rootDir: string,
  id: string,
  stdout: Writable,
): Promise<void> {
  const skillDir = await resolveSkillDir(rootDir, id);
  const { entries } = await collectSkillEntries(skillDir, id);
  const tarStream = createTarStream(entries);
  await pipeToWritable(tarStream, stdout);
}
