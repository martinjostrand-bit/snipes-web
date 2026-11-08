// PreToolUse hook (spec 5.7, 6.3): inside the verifier agent, allows only commands that
// read the repository or run the four checks. Exit code 2 blocks the command; other
// agents and the main session pass. Adapted from MissingFiles' verifier-bash-guard.js.
// The command text is checked with its quotes removed, and text the shell would expand is blocked.
const allowed = [
  /^cd [\w:/.-]+$/,
  /^git (status|diff|log|show|rev-parse|rev-list|ls-files|blame|check-ignore|cat-file|merge-base)( |$)/,
  /^npm run check$/,
  /^npm test$/,
  /^npm run build$/,
  /^npm run test:e2e$/,
  /^(cat|head|tail|grep|wc|ls|echo) /,
];

function reason(command) {
  // A redirection is harmless only if its word ends there. Removing quotes comes second,
  // because a quote attached to the redirection is part of its target.
  const text = command
    .replace(/ 2>(&1|\/dev\/null)(?=[\s;&|]|$)/g, "")
    .replace(/["']/g, "");

  if (/[<>`\\{}]|\$\S/.test(text)) {
    return "redirection, expansion, substitution and backslashes are not allowed";
  }
  // Prefixes, because git accepts a unique prefix of a long option.
  if (/--out|--ext|--textc|--exec/.test(text)) {
    return "options that write files or run programs are not allowed";
  }

  const segments = text.split(/&&|\|\||[;|&\n]/).map((s) => s.trim());
  // The checks run only where the verifier starts, in the project, so never after a cd.
  if (
    segments.some((s) => s.startsWith("cd ")) &&
    segments.some((s) => s.startsWith("npm "))
  ) {
    return "the checks run only in the project directory, not after cd";
  }
  const blocked = segments.find((s) => !allowed.some((p) => p.test(s)));
  return blocked === undefined
    ? null
    : `not an allowed read-only command: ${blocked}`;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const { agent_type: agentType, tool_input: toolInput } = JSON.parse(input);
  const problem = agentType === "verifier" ? reason(toolInput.command) : null;
  if (problem) {
    console.error(`The verifier cannot run this: ${problem}.`);
    process.exit(2);
  }
});
