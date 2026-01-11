import { Writable } from "node:stream";

export type Capture = {
  stream: Writable;
  text: () => string;
  buffer: () => Buffer;
};

export function createCapture(): Capture {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  return {
    stream,
    text: () => Buffer.concat(chunks).toString("utf8"),
    buffer: () => Buffer.concat(chunks),
  };
}
