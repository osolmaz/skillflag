import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import * as tar from "tar-stream";
import { Readable } from "node:stream";

import { SkillflagError } from "./errors.js";

const FIXED_MTIME = new Date(0);

type TarEntry = {
  name: string;
  type: "file" | "directory";
  absPath?: string;
  size?: number;
  mode: number;
};

export type CollectedSkillEntries = {
  entries: TarEntry[];
  fileCount: number;
};

function isInvalidRelPath(relPosix: string): boolean {
  if (path.posix.isAbsolute(relPosix)) return true;
  const parts = relPosix.split("/");
  return parts.includes("..");
}

async function collectEntriesForDir(
  rootDir: string,
  relPosix: string,
  id: string,
  dirs: Set<string>,
  files: TarEntry[],
): Promise<void> {
  dirs.add(relPosix);
  const absDir = relPosix
    ? path.join(rootDir, ...relPosix.split("/"))
    : rootDir;
  const dirents = await fsPromises.readdir(absDir, { withFileTypes: true });

  for (const dirent of dirents) {
    const name = dirent.name;
    const relChild = relPosix ? `${relPosix}/${name}` : name;

    if (isInvalidRelPath(relChild)) {
      throw new SkillflagError(`Invalid path in skill: ${id}/${relChild}`);
    }

    const absChild = path.join(absDir, name);
    if (dirent.isDirectory()) {
      await collectEntriesForDir(rootDir, relChild, id, dirs, files);
      continue;
    }

    if (dirent.isFile()) {
      const stat = await fsPromises.stat(absChild);
      files.push({
        name: `${id}/${relChild}`,
        type: "file",
        absPath: absChild,
        size: stat.size,
        mode: stat.mode & 0o777,
      });
      continue;
    }

    if (dirent.isSymbolicLink()) {
      throw new SkillflagError(
        `Symlinks are not supported in skill bundles: ${id}/${relChild}`,
      );
    }

    throw new SkillflagError(
      `Unsupported file type in skill bundle: ${id}/${relChild}`,
    );
  }
}

export async function collectSkillEntries(
  skillDir: string,
  id: string,
): Promise<CollectedSkillEntries> {
  const dirs = new Set<string>();
  const files: TarEntry[] = [];

  await collectEntriesForDir(skillDir, "", id, dirs, files);

  const dirEntries: TarEntry[] = [];
  for (const relDir of dirs) {
    const absDir = relDir
      ? path.join(skillDir, ...relDir.split("/"))
      : skillDir;
    const stat = await fsPromises.stat(absDir);
    const dirName = relDir ? `${id}/${relDir}/` : `${id}/`;
    dirEntries.push({
      name: dirName,
      type: "directory",
      mode: stat.mode & 0o777,
    });
  }

  const entries = [...dirEntries, ...files].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return { entries, fileCount: files.length };
}

function writeDirEntry(
  pack: tar.Pack,
  entry: TarEntry,
): Promise<void> {
  return new Promise((resolve, reject) => {
    pack.entry(
      {
        name: entry.name,
        type: "directory",
        mode: entry.mode,
        mtime: FIXED_MTIME,
        uid: 0,
        gid: 0,
        uname: "",
        gname: "",
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}

function writeFileEntry(
  pack: tar.Pack,
  entry: TarEntry,
): Promise<void> {
  if (!entry.absPath) {
    return Promise.reject(new Error(`Missing file path for ${entry.name}`));
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(entry.absPath);
    const tarEntry = pack.entry(
      {
        name: entry.name,
        type: "file",
        mode: entry.mode,
        size: entry.size,
        mtime: FIXED_MTIME,
        uid: 0,
        gid: 0,
        uname: "",
        gname: "",
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      },
    );

    fileStream.on("error", reject);
    tarEntry.on("error", reject);
    fileStream.pipe(tarEntry);
  });
}

export function createTarStream(entries: TarEntry[]): Readable {
  const pack = tar.pack();

  void (async () => {
    try {
      for (const entry of entries) {
        if (entry.type === "directory") {
          await writeDirEntry(pack, entry);
        } else {
          await writeFileEntry(pack, entry);
        }
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();

  return pack;
}
