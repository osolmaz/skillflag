import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";

import { runInstallCli, type InstallPromptApi } from "../../src/install/cli.js";
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

type PromptStubOptions = {
  textResponses?: Array<string | typeof PROMPT_CANCEL>;
  multiselectResponses?: Array<unknown[] | typeof PROMPT_CANCEL>;
  confirmResponses?: Array<boolean | typeof PROMPT_CANCEL>;
};

type PromptStub = {
  promptApi: InstallPromptApi;
  notes: string[];
  outros: string[];
};

function createPromptStub(options: PromptStubOptions = {}): PromptStub {
  const textResponses = [...(options.textResponses ?? [])];
  const multiselectResponses = [...(options.multiselectResponses ?? [])];
  const confirmResponses = [...(options.confirmResponses ?? [])];
  const notes: string[] = [];
  const outros: string[] = [];

  const promptApi: InstallPromptApi = {
    confirm: async () => {
      if (confirmResponses.length === 0) {
        throw new Error("No prompt stub response configured for confirm.");
      }
      return confirmResponses.shift() as boolean | symbol;
    },
    intro: () => {},
    isCancel: (value: unknown): value is symbol => value === PROMPT_CANCEL,
    multiselect: async <Value>() => {
      if (multiselectResponses.length === 0) {
        throw new Error("No prompt stub response configured for multiselect.");
      }
      const response = multiselectResponses.shift();
      return response as Value[] | symbol;
    },
    note: (message?: string) => {
      notes.push(message ?? "");
    },
    outro: (message?: string) => {
      outros.push(message ?? "");
    },
    spinner: () => ({
      start: () => {},
      stop: () => {},
      error: () => {},
    }),
    text: async () => {
      if (textResponses.length === 0) {
        throw new Error("No prompt stub response configured for text.");
      }
      return textResponses.shift() as string | symbol;
    },
  };

  return { promptApi, notes, outros };
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
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "claude",
      "--scope",
      "admin",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Unsupported agent\/scope: claude admin/);
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
