#!/usr/bin/env node

/**
 * Postinstall script for bart-loop.
 * Copies skill files to ~/.claude/skills/ so Claude Code can discover them.
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const skillsDir = join(homedir(), ".claude", "skills");

// Skills to install: [source relative to project root, subdirectory name]
const skills = [
  ["SKILL.md", "bart-loop"],
  [join("skills", "bart-plan", "SKILL.md"), "bart-plan"],
];

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
  }
} catch (err) {
  // Non-fatal — don't break npm install if skill copy fails
  console.warn(`bart-loop: could not install skills (${err.message})`);
}
