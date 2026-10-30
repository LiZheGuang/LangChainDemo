#!/usr/bin/env node

// The full-screen UI needs raw keyboard input; piped stdin falls back to plain lines.
if (process.stdin.isTTY && process.stdout.isTTY && !process.argv.includes("--plain")) {
  const { runTui } = await import("./tui/index.js");
  await runTui();
} else {
  const { runPlainCli } = await import("./plain-cli.js");
  await runPlainCli();
}
