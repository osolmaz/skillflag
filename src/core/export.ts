import { collectSkillEntries, createTarStream } from "./tar.js";

async function pipeToWritable(
  stream: NodeJS.ReadableStream,
  dest: NodeJS.WritableStream,
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
  skillDir: string,
  id: string,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const { entries } = await collectSkillEntries(skillDir, id);
  const tarStream = createTarStream(entries);
  await pipeToWritable(tarStream, stdout);
}
