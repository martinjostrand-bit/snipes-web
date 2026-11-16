---
name: release
description: Tag a Snipes Web release, which deploys it to production after Martin approves, then publish it on GitHub Releases (spec 5.5).
disable-model-invocation: true
effort: medium
---

Publish a release according to spec 5.5. A release is public, so get Martin's confirmation at step 4 before tagging or publishing.

1. Check the prerequisites, and stop if any fails:
   - The current branch is `main`, the working tree is clean, and `HEAD` matches `origin/main` after `git fetch`.
   - Martin has played a full game on the staging preview of `HEAD` (its URL is in the run summary of the "Build, check & deploy" run for `HEAD`) and ticked the play checklist in 6.4. Ask Martin.
   - Secret scanning and push protection are on. Run both commands, and stop unless each prints exactly `enabled`. Any other output, including empty output or `null`, stops the release:

     ```bash
     gh api repos/martinjostrand-bit/snipes-web --jq .security_and_analysis.secret_scanning.status
     gh api repos/martinjostrand-bit/snipes-web --jq .security_and_analysis.secret_scanning_push_protection.status
     ```

2. Find the "Build, check & deploy" run for `HEAD`, and stop unless its `checks` job succeeded:

   ```bash
   gh run list --workflow "Build, check & deploy" --commit "$(git rev-parse HEAD)" --json databaseId,conclusion
   gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
   ```

3. Read the version from `package.json`. Compare it with the latest tag from `git tag --list 'v*'`. Check that the tag doesn't exist yet, that each of MAJOR, MINOR and PATCH went up at most once, and that `CHANGELOG.md` has a section for this version.
4. Show Martin the version, the commit and the changelog section, and ask for confirmation.
5. Tag and push. The tag starts a "Build, check & deploy" run whose `deploy` job waits for Martin's approval (spec 7):

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

6. Tell Martin to approve the waiting deploy: **Actions** → the run for `vX.Y.Z` → **Review deployments** → **production** → **Approve and deploy**. Wait for the run with `gh run watch <id>`, and stop unless `checks` and `deploy` succeeded. If it failed, report the failing step and leave the tag for Martin to decide on.
7. Publish, with the changelog section as the notes (written to a file in the scratchpad):

   ```bash
   gh release create vX.Y.Z --title "Snipes Web X.Y.Z" --notes-file <notes>
   ```

8. Report the release URL.
