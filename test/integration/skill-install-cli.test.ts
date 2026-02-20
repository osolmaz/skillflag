import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable, type Writable } from "node:stream";
import type { Option } from "@clack/prompts";

import { runInstallCli, type InstallPromptApi } from "../../src/install/cli.js";
import { collectSkillEntries, createTarStream } from "../../src/core/tar.js";
import { createCapture } from "../helpers/capture.js";
import { makeTempDir, writeFile } from "../helpers/tmp.js";

function initGit(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir });
}

const PROMPT_CANCEL = Symbol("prompt-cancel");

function createTtyStdin(): Readable {
  const stdin = Readable.from([]);
  (stdin as Readable & { isTTY?: boolean }).isTTY = true;
  return stdin;
}

function createPipeStdin(buffer: Buffer): Readable {
  const stdin = Readable.from([buffer]);
  (stdin as Readable & { fd?: number }).fd = 0;
  return stdin;
}

function createCountingPipeStdin(totalBytes: number): {
  stdin: Readable;
  pushedBytes: () => number;
} {
  let pushed = 0;
  const stdin = new Readable({
    read() {
      if (pushed >= totalBytes) {
        this.push(null);
        return;
      }
      const size = Math.min(16 * 1024, totalBytes - pushed);
      pushed += size;
      this.push(Buffer.alloc(size, 0x78));
    },
  });
  (stdin as Readable & { fd?: number }).fd = 0;
  return {
    stdin,
    pushedBytes: () => pushed,
  };
}

async function bufferFromStream(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

type PromptStubOptions = {
  textResponses?: Array<string | typeof PROMPT_CANCEL>;
  multiselectResponses?: Array<unknown[] | typeof PROMPT_CANCEL>;
  confirmResponses?: Array<boolean | typeof PROMPT_CANCEL>;
};

type PromptStub = {
  promptApi: InstallPromptApi;
  notes: string[];
  outros: string[];
  promptInputs: Array<Readable | undefined>;
  promptOutputs: Array<Writable | undefined>;
};

function createPromptStub(options: PromptStubOptions = {}): PromptStub {
  const textResponses = [...(options.textResponses ?? [])];
  const multiselectResponses = [...(options.multiselectResponses ?? [])];
  const confirmResponses = [...(options.confirmResponses ?? [])];
  const notes: string[] = [];
  const outros: string[] = [];
  const promptInputs: Array<Readable | undefined> = [];
  const promptOutputs: Array<Writable | undefined> = [];

  const trackIo = (opts?: { input?: Readable; output?: Writable }): void => {
    promptInputs.push(opts?.input);
    promptOutputs.push(opts?.output);
  };

  const promptApi: InstallPromptApi = {
    confirm: async (opts) => {
      trackIo(opts);
      if (confirmResponses.length === 0) {
        throw new Error("No prompt stub response configured for confirm.");
      }
      return confirmResponses.shift() as boolean | symbol;
    },
    intro: (_message, opts) => {
      trackIo(opts);
    },
    isCancel: (value: unknown): value is symbol => value === PROMPT_CANCEL,
    multiselect: async <Value>(opts: {
      message: string;
      options: Option<Value>[];
      initialValues?: Value[];
      required?: boolean;
      input?: Readable;
      output?: Writable;
    }) => {
      trackIo(opts);
      if (multiselectResponses.length === 0) {
        throw new Error("No prompt stub response configured for multiselect.");
      }
      const response = multiselectResponses.shift();
      return response as Value[] | symbol;
    },
    note: (
      message?: string,
      _title?: string,
      opts?: {
        input?: Readable;
        output?: Writable;
      },
    ) => {
      trackIo(opts);
      notes.push(message ?? "");
    },
    outro: (
      message?: string,
      opts?: { input?: Readable; output?: Writable },
    ) => {
      trackIo(opts);
      outros.push(message ?? "");
    },
    spinner: (opts) => {
      trackIo(opts);
      return {
        start: () => {},
        stop: () => {},
        error: () => {},
      };
    },
    text: async (opts) => {
      trackIo(opts);
      if (textResponses.length === 0) {
        throw new Error("No prompt stub response configured for text.");
      }
      return textResponses.shift() as string | symbol;
    },
  };

  return { promptApi, notes, outros, promptInputs, promptOutputs };
}

test("runInstallCli requires flags without an interactive tty", async () => {
  const stderr = createCapture();

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: Readable.from([]),
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Missing required flags/);
  assert.match(stderr.text(), /skill-install \[PATH/);
});

test("runInstallCli supports --help", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await runInstallCli(["node", "skill-install", "--help"], {
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.text(), /Usage:/);
  assert.match(stdout.text(), /--help/);
  assert.equal(stderr.text(), "");
});

test("runInstallCli uses tty prompts when stdin is piped and required flags are missing", async (t) => {
  const repo = await makeTempDir("skill-install-cli-pipe-wizard-repo-");
  const skill = await makeTempDir("skill-install-cli-pipe-wizard-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);
  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-pipe-wizard\ndescription: Pipe wizard skill\n---\n",
  );
  await writeFile(skill.dir, "templates/example.txt", "hello\n");

  const { entries } = await collectSkillEntries(
    skill.dir,
    "cli-skill-pipe-wizard",
  );
  const tarBuffer = await bufferFromStream(createTarStream(entries));
  const promptStdin = createTtyStdin();
  const promptStdout = createCapture();
  const prompt = createPromptStub({
    multiselectResponses: [["codex"], ["repo"]],
    confirmResponses: [false, true],
  });
  const stderr = createCapture();

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: createPipeStdin(tarBuffer),
    stderr: stderr.stream,
    cwd: repo.dir,
    promptApi: prompt.promptApi,
    openPromptTty: () => ({
      input: promptStdin,
      output: promptStdout.stream,
      close: () => {},
    }),
  });

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-pipe-wizard to/);
  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-pipe-wizard/SKILL.md"),
  );
  assert.ok(prompt.promptInputs.length > 0);
  assert.ok(
    prompt.promptInputs.every((input) => input === promptStdin),
    "expected wizard prompts to use tty input",
  );
  assert.ok(
    prompt.promptOutputs.every((output) => output === promptStdout.stream),
    "expected wizard prompts to use tty output",
  );
});

test("runInstallCli buffers piped stdin before interactive wizard prompts", async (t) => {
  const repo = await makeTempDir("skill-install-cli-pipe-buffer-repo-");
  const skill = await makeTempDir("skill-install-cli-pipe-buffer-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);
  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-pipe-buffer\ndescription: Pipe buffer skill\n---\n",
  );
  await writeFile(skill.dir, "templates/example.txt", "hello\n");

  const { entries } = await collectSkillEntries(
    skill.dir,
    "cli-skill-pipe-buffer",
  );
  const tarBuffer = await bufferFromStream(createTarStream(entries));
  const sourceStdin = createPipeStdin(tarBuffer);
  const promptStdin = createTtyStdin();
  const promptStdout = createCapture();
  const stderr = createCapture();

  let observedSourceEndedAtFirstPrompt: boolean | undefined;
  const multiselectResponses: Array<string[]> = [["codex"], ["repo"]];
  const confirmResponses = [false, true];

  const promptApi: InstallPromptApi = {
    confirm: async () => confirmResponses.shift() as boolean,
    intro: () => {},
    isCancel: (value: unknown): value is symbol => typeof value === "symbol",
    multiselect: async <Value>() => {
      if (observedSourceEndedAtFirstPrompt === undefined) {
        observedSourceEndedAtFirstPrompt = sourceStdin.readableEnded;
      }
      return multiselectResponses.shift() as Value[];
    },
    note: () => {},
    outro: () => {},
    spinner: () => ({
      start: () => {},
      stop: () => {},
      error: () => {},
    }),
    text: async () => "",
  };

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: sourceStdin,
    stderr: stderr.stream,
    cwd: repo.dir,
    promptApi,
    openPromptTty: () => ({
      input: promptStdin,
      output: promptStdout.stream,
      close: () => {},
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(observedSourceEndedAtFirstPrompt, true);
  assert.match(stderr.text(), /Installed cli-skill-pipe-buffer to/);
});

test("runInstallCli falls back to required flags and drains piped stdin when tty prompts are unavailable", async () => {
  const stderr = createCapture();
  const source = createCountingPipeStdin(256 * 1024);

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: source.stdin,
    stderr: stderr.stream,
    openPromptTty: () => null,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Missing required flags/);
  assert.equal(source.pushedBytes(), 256 * 1024);
});

test("runInstallCli installs from piped tar with explicit flags non-interactively", async (t) => {
  const repo = await makeTempDir("skill-install-cli-pipe-flags-repo-");
  const skill = await makeTempDir("skill-install-cli-pipe-flags-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);
  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-pipe-flags\ndescription: Pipe flags skill\n---\n",
  );
  await writeFile(skill.dir, "templates/example.txt", "hello\n");

  const { entries } = await collectSkillEntries(
    skill.dir,
    "cli-skill-pipe-flags",
  );
  const tarBuffer = await bufferFromStream(createTarStream(entries));

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    ["node", "skill-install", "--agent", "codex", "--scope", "repo"],
    {
      stdin: createPipeStdin(tarBuffer),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-pipe-flags to/);
  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-pipe-flags/SKILL.md"),
  );
});

test("runInstallCli keeps non-interactive install behavior with flags", async (t) => {
  const repo = await makeTempDir("skill-install-cli-repo-");
  const skill = await makeTempDir("skill-install-cli-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill\ndescription: CLI test skill\n---\n",
  );
  await writeFile(skill.dir, "templates/readme.txt", "hello\n");

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    ["node", "skill-install", skill.dir, "--agent", "codex", "--scope", "repo"],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill to/);

  const installedSkill = path.join(
    repo.dir,
    ".codex/skills/cli-skill/SKILL.md",
  );
  const installedContent = await fs.readFile(installedSkill, "utf8");
  assert.match(installedContent, /name: cli-skill/);
});

test("runInstallCli installs multiple skills across repeated scopes", async (t) => {
  const repo = await makeTempDir("skill-install-cli-multi-repo-");
  const codexHome = await makeTempDir("skill-install-cli-multi-codex-home-");
  const skillOne = await makeTempDir("skill-install-cli-skill-one-");
  const skillTwo = await makeTempDir("skill-install-cli-skill-two-");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await skillOne.cleanup();
    await skillTwo.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skillOne.dir,
    "SKILL.md",
    "---\nname: cli-skill-one\ndescription: CLI multi test skill one\n---\n",
  );
  await writeFile(
    skillTwo.dir,
    "SKILL.md",
    "---\nname: cli-skill-two\ndescription: CLI multi test skill two\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skillOne.dir,
      skillTwo.dir,
      "--agent",
      "codex",
      "--scope",
      "repo",
      "--scope",
      "user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-one to/);
  assert.match(stderr.text(), /Installed cli-skill-two to/);

  await fs.access(path.join(repo.dir, ".codex/skills/cli-skill-one/SKILL.md"));
  await fs.access(path.join(repo.dir, ".codex/skills/cli-skill-two/SKILL.md"));
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-one/SKILL.md"));
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-two/SKILL.md"));
});

test("runInstallCli accepts comma-separated scopes", async (t) => {
  const repo = await makeTempDir("skill-install-cli-comma-repo-");
  const codexHome = await makeTempDir("skill-install-cli-comma-codex-home-");
  const skill = await makeTempDir("skill-install-cli-comma-skill-");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-comma\ndescription: CLI comma scope skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "codex",
      "--scope",
      "repo,user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-comma to/);

  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-comma/SKILL.md"),
  );
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-comma/SKILL.md"));
});

test("runInstallCli supports repeated --agent and installs matrix combinations", async (t) => {
  const repo = await makeTempDir("skill-install-cli-agents-repo-");
  const codexHome = await makeTempDir("skill-install-cli-agents-codex-home-");
  const home = await makeTempDir("skill-install-cli-agents-home-");
  const skill = await makeTempDir("skill-install-cli-agents-skill-");
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHome = process.env.HOME;
  process.env.CODEX_HOME = codexHome.dir;
  process.env.HOME = home.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    process.env.HOME = previousHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await home.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-agents\ndescription: CLI multi-agent test skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "codex",
      "--agent",
      "claude",
      "--scope",
      "repo",
      "--scope",
      "user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  const installLines = stderr
    .text()
    .split("\n")
    .filter((line) => line.startsWith("Installed "));
  assert.equal(installLines.length, 4);

  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-agents/SKILL.md"),
  );
  await fs.access(
    path.join(repo.dir, ".claude/skills/cli-skill-agents/SKILL.md"),
  );
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-agents/SKILL.md"));
  await fs.access(
    path.join(home.dir, ".claude/skills/cli-skill-agents/SKILL.md"),
  );
});

test("runInstallCli fails preflight when selected agents/scopes collide on destination", async (t) => {
  const repo = await makeTempDir("skill-install-cli-shared-dest-repo-");
  const skill = await makeTempDir("skill-install-cli-shared-dest-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-shared\ndescription: CLI shared destination test skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "portable",
      "--agent",
      "amp",
      "--scope",
      "repo",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Install destination collisions detected/);
  assert.match(stderr.text(), /\.agents\/skills\/cli-skill-shared/);
  await assert.rejects(
    fs.access(path.join(repo.dir, ".agents/skills/cli-skill-shared/SKILL.md")),
  );
});

test("runInstallCli fails for unsupported agent/scope combinations", async (t) => {
  const repo = await makeTempDir("skill-install-cli-unsupported-repo-");
  const skill = await makeTempDir("skill-install-cli-unsupported-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-unsupported\ndescription: Unsupported combo skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    ["node", "skill-install", skill.dir, "--agent", "claude", "--scope", "cwd"],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Unsupported agent\/scope: claude cwd/);
});

test("runInstallCli detects collisions for different sources with the same skill name", async (t) => {
  const repo = await makeTempDir("skill-install-cli-collision-repo-");
  const skillOne = await makeTempDir("skill-install-cli-collision-one-");
  const skillTwo = await makeTempDir("skill-install-cli-collision-two-");
  t.after(async () => {
    await repo.cleanup();
    await skillOne.cleanup();
    await skillTwo.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skillOne.dir,
    "SKILL.md",
    "---\nname: cli-skill-collision\ndescription: Collision test one\n---\n",
  );
  await writeFile(
    skillTwo.dir,
    "SKILL.md",
    "---\nname: cli-skill-collision\ndescription: Collision test two\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skillOne.dir,
      skillTwo.dir,
      "--agent",
      "codex",
      "--scope",
      "repo",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Install destination collisions detected/);
  assert.match(stderr.text(), /cli-skill-collision @ codex\/repo/);
  await assert.rejects(
    fs.access(
      path.join(repo.dir, ".codex/skills/cli-skill-collision/SKILL.md"),
    ),
  );
});

test("runInstallCli wizard cancellation works at each prompt step", async (t) => {
  const repo = await makeTempDir("skill-install-cli-cancel-repo-");
  const skill = await makeTempDir("skill-install-cli-cancel-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);
  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-cancel\ndescription: Wizard cancellation skill\n---\n",
  );

  await t.test("path prompt", async () => {
    const prompt = createPromptStub({
      textResponses: [PROMPT_CANCEL],
    });
    const exitCode = await runInstallCli(["node", "skill-install"], {
      stdin: createTtyStdin(),
      cwd: repo.dir,
      promptApi: prompt.promptApi,
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(prompt.outros, ["Install cancelled."]);
  });

  await t.test("agent prompt", async () => {
    const prompt = createPromptStub({
      multiselectResponses: [PROMPT_CANCEL],
    });
    const exitCode = await runInstallCli(["node", "skill-install", skill.dir], {
      stdin: createTtyStdin(),
      cwd: repo.dir,
      promptApi: prompt.promptApi,
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(prompt.outros, ["Install cancelled."]);
  });

  await t.test("scope prompt", async () => {
    const prompt = createPromptStub({
      multiselectResponses: [PROMPT_CANCEL],
    });
    const exitCode = await runInstallCli(
      ["node", "skill-install", skill.dir, "--agent", "codex"],
      {
        stdin: createTtyStdin(),
        cwd: repo.dir,
        promptApi: prompt.promptApi,
      },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(prompt.outros, ["Install cancelled."]);
  });

  await t.test("force prompt", async () => {
    const prompt = createPromptStub({
      multiselectResponses: [["repo"]],
      confirmResponses: [PROMPT_CANCEL],
    });
    const exitCode = await runInstallCli(
      ["node", "skill-install", skill.dir, "--agent", "codex"],
      {
        stdin: createTtyStdin(),
        cwd: repo.dir,
        promptApi: prompt.promptApi,
      },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(prompt.outros, ["Install cancelled."]);
  });

  await t.test("confirmation prompt", async () => {
    const prompt = createPromptStub({
      multiselectResponses: [["repo"]],
      confirmResponses: [false, PROMPT_CANCEL],
    });
    const exitCode = await runInstallCli(
      ["node", "skill-install", skill.dir, "--agent", "codex"],
      {
        stdin: createTtyStdin(),
        cwd: repo.dir,
        promptApi: prompt.promptApi,
      },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(prompt.outros, ["Install cancelled."]);
  });
});

test("runInstallCli wizard confirmation matrix includes expected content", async (t) => {
  const repo = await makeTempDir("skill-install-cli-matrix-repo-");
  const skillOne = await makeTempDir("skill-install-cli-matrix-one-");
  const skillTwo = await makeTempDir("skill-install-cli-matrix-two-");
  t.after(async () => {
    await repo.cleanup();
    await skillOne.cleanup();
    await skillTwo.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skillOne.dir,
    "SKILL.md",
    "---\nname: cli-skill-matrix-one\ndescription: Matrix test one\n---\n",
  );
  await writeFile(
    skillTwo.dir,
    "SKILL.md",
    "---\nname: cli-skill-matrix-two\ndescription: Matrix test two\n---\n",
  );

  const prompt = createPromptStub({
    textResponses: [`${skillOne.dir},${skillTwo.dir}`],
    multiselectResponses: [
      ["codex", "claude"],
      ["repo", "user"],
    ],
    confirmResponses: [false, false],
  });

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: createTtyStdin(),
    cwd: repo.dir,
    promptApi: prompt.promptApi,
  });

  assert.equal(exitCode, 1);
  assert.equal(prompt.notes.length, 1);
  const summary = prompt.notes[0];
  assert.match(summary, /Sources \(2\):/);
  assert.match(summary, /Agents \(2\): codex, claude/);
  assert.match(summary, /Scopes \(2\): repo, user/);
  assert.match(
    summary,
    /Matrix: 2 skill\(s\) × 2 agent\(s\) × 2 scope\(s\) = 8 combination\(s\)/,
  );
  assert.match(summary, /Planned combinations \(8\):/);
});
