#!/usr/bin/env node

/**
 * Postinstall script for bart-loop.
 * Copies all skill files to ~/.claude/skills/ and installs shell completions.
 * Mirrors what `bart install` does so `npm i -g bart-loop` is a single-step setup.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const home = homedir();

const skillsDir = join(home, ".claude", "skills");

// All skills — keep in sync with the install case in src/cli.ts
const skills = [
  ["SKILL.md", "bart-loop"],
  [join("skills", "bart-plan", "SKILL.md"), "bart-plan"],
  [join("skills", "bart-think", "SKILL.md"), "bart-think"],
  [join("skills", "bart-new-specialist", "SKILL.md"), "bart-new-specialist"],
];

// --- Skills Installation ---

let installed = 0;
try {
  for (const [src, dirName] of skills) {
    const srcPath = join(projectRoot, src);
    const destDir = join(skillsDir, dirName);

    if (!existsSync(srcPath)) {
      console.warn(`bart-loop: skill source not found, skipping: ${src}`);
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    copyFileSync(srcPath, join(destDir, "SKILL.md"));
    console.log(`bart-loop: installed ${dirName} → ${destDir}/SKILL.md`);
    installed++;
  }

  if (installed > 0) {
    console.log(`bart-loop: ${installed} skill(s) installed to ${skillsDir}`);
  }
} catch (err) {
  // Non-fatal — don't break npm install if skill copy fails
  console.warn(`bart-loop: could not install skills (${err.message})`);
}

// --- Shell Completions ---

try {
  const shell = (process.env.SHELL || "").toLowerCase();
  const completionsDir = join(home, ".bart", "completions");
  mkdirSync(completionsDir, { recursive: true });

  if (shell.includes("zsh")) {
    // Try to run `bart completions zsh` if bart is already on PATH
    // Otherwise skip — user can run `bart install` later
    try {
      const script = execSync("bart completions zsh", { encoding: "utf-8", timeout: 5000 });
      const completionFile = join(completionsDir, "_bart");
      writeFileSync(completionFile, script);

      const rcFile = join(home, ".zshrc");
      const marker = "# bart-loop completions";
      const block = [
        marker,
        `fpath=(${completionsDir} $fpath)`,
        "autoload -Uz compinit && compinit -C",
        "# end bart-loop completions",
      ].join("\n");

      let rc = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
      if (!rc.includes(marker)) {
        writeFileSync(rcFile, rc + "\n" + block + "\n");
        console.log("bart-loop: zsh completions installed");
      }
    } catch {
      // bart not on PATH yet (first install) — completions will be set up on `bart install`
    }
  } else if (shell.includes("bash")) {
    try {
      const script = execSync("bart completions bash", { encoding: "utf-8", timeout: 5000 });
      const completionFile = join(completionsDir, "bart.bash");
      writeFileSync(completionFile, script);

      const rcFile = join(home, ".bashrc");
      const marker = "# bart-loop completions";
      const sourceLine = `source ${completionFile}`;
      const block = [marker, sourceLine, "# end bart-loop completions"].join("\n");

      let rc = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
      if (!rc.includes(marker)) {
        writeFileSync(rcFile, rc + "\n" + block + "\n");
        console.log("bart-loop: bash completions installed");
      }
    } catch {
      // bart not on PATH yet — skip
    }
  }
} catch (err) {
  // Non-fatal
  console.warn(`bart-loop: could not install completions (${err.message})`);
}
