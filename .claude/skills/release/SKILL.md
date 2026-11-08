---
name: release
description: Tag and publish a Snipes Web release on GitHub Releases from a deployed main commit (spec 5.5).
disable-model-invocation: true
effort: medium
---

Publish a release according to spec 5.5. A release is public, so get Martin's confirmation at step 4 before tagging or publishing.

1. Check the prerequisites, and stop if any fails:
   - The current branch is `main`, the working tree is clean, and `HEAD` matches `origin/main` after `git fetch`.
   - Martin has played a full game and ticked the play checklist in 6.4 for this release. Ask Martin.
   - Secret scanning and push protection are on. Run both commands, and stop unless each prints exactly `enabled`. Any other output, including empty output or `null`, stops the release:

     ```bash
     gh api repos/martinjostrand-bit/snipes-web --jq .security_and_analysis.secret_scanning.status
     gh api repos/martinjostrand-bit/snipes-web --jq .security_and_analysis.secret_scanning_push_protection.status
     ```

2. Find the "Build, check & deploy" run for `HEAD`, and stop unless both its `checks` and `deploy` jobs succeeded, so this commit is the one in production:

   ```bash
   gh run list --workflow "Build, check & deploy" --commit "$(git rev-parse HEAD)" --json databaseId,conclusion
   gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
   ```

3. Read the version from `package.json`. Compare it with the latest tag from `git tag --list 'v*'`. Check that the tag doesn't exist yet, that each of MAJOR, MINOR and PATCH went up at most once, and that `CHANGELOG.md` has a section for this version.
4. Show Martin the version, the commit and the changelog section, and ask for confirmation.
5. Tag and publish, with the changelog section as the notes (written to a file in the scratchpad):

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "Snipes Web X.Y.Z" --notes-file <notes>
   ```

6. Report the release URL.
