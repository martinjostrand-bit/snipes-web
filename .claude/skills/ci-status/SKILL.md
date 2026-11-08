---
name: ci-status
description: Report the result of the latest CI and CodeQL runs for the current Snipes Web commit or pull request.
effort: low
allowed-tools: Bash(git rev-parse*), Bash(git branch --show-current), Bash(gh run list*), Bash(gh run view*), Bash(gh pr checks*), Bash(gh pr view*)
---

1. List the runs for the current commit:

   ```bash
   gh run list --commit "$(git rev-parse HEAD)" --json databaseId,workflowName,status,conclusion,url
   ```

2. If the branch has an open PR, also show its checks with `gh pr checks`, and its preview URL from the PR comments (`gh pr view --json comments`).
3. Report each workflow as passed, failed, waiting for approval or still running. If there are no runs yet, say so.
4. For a failed run, show the failing step from `gh run view <id> --log-failed`, limited to the relevant lines.

Report the state once. Do not wait for runs to finish unless Martin asks.
