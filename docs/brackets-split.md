# Splitting brackets into its own repository

`brackets/` becomes `BattyDev/batty-brackets`, and `battydev.com/brackets`
keeps working because the site is assembled from both repositories at build
time. The URL does not change and nothing redirects.

This replaces branch-based Pages deployment with an Actions workflow, so the
order below matters. Follow it as written; the risky step is flagged.

## What's already in place

| File | Repo it serves | Live when |
|---|---|---|
| `.github/workflows/pages.yml` | this one | on merge to `main` |
| `brackets/.github/workflows/ci.yml` | the new one | after the split |
| `brackets/.github/workflows/publish.yml` | the new one | after the split |

The two under `brackets/` are inert here — GitHub only reads workflows at a
repository root — and `git subtree split` puts them at the new root, where they
start working.

## Steps

**1. Split the history.** From this branch, so the new repo starts with the
current docs:

```
git subtree split --prefix=brackets -b brackets-split
```

Produces a 14-commit branch whose root is the contents of `brackets/`.

**2. Create `BattyDev/batty-brackets` on GitHub.** Empty — no README, no
`.gitignore`, no licence. An initial commit means a merge conflict on the next
step.

**3. Push.**

```
git push https://github.com/BattyDev/batty-brackets.git brackets-split:main
```

**4. Confirm the Tests workflow is green there** before going further. It
installs Playwright and runs all 19 suites, and it asserts Playwright actually
resolved — `run.mjs` skips the 16 browser suites and still exits 0 when it is
missing, which would otherwise show as a green run covering 3 suites.

**5. Add the dispatch token.** In `batty-brackets` → Settings → Secrets and
variables → Actions, add `SITE_DISPATCH_TOKEN`: a fine-grained PAT scoped to
`BattyDev.github.io` with **Contents: read and write**. The built-in
`GITHUB_TOKEN` cannot dispatch across repositories. Without it, pushes to
brackets won't reach the site and `publish.yml` fails with a clear message
rather than silently doing nothing.

**6. Merge this branch into `main` here.** `pages.yml` runs and builds. The
deploy step **will fail**, because Pages is still set to deploy from a branch.
That is expected, and the live site is unaffected — the branch deploy is still
what's serving.

**7. Flip the Pages source.** Settings → Pages → Build and deployment → Source:
**GitHub Actions**. Then re-run the failed workflow. This is the cutover.

**8. Check `battydev.com/brackets` loads**, along with one page from the rest of
the site (`/guides`, `/ffxiv`) to confirm nothing else moved.

**9. Only now, delete the folder here:**

```
git rm -r brackets
git commit -m "Remove brackets; it now lives in BattyDev/batty-brackets"
```

The rebuild pulls it back in from the new repo. Leaving this until last means
every earlier step is reversible.

## Rolling back

Before step 9: Settings → Pages → Source → Deploy from a branch → `main`. The
folder is still committed here, so the site returns to exactly what it was.

After step 9: revert the deletion commit first, then flip the source back.

## Afterwards

- A change to brackets goes: push → Tests → `publish.yml` dispatches →
  `pages.yml` rebuilds the site. A minute or two, not instant.
- `brackets/AGENTS.md` says Pages serves `main` directly with no CI step. True
  today, wrong after step 7 — update its **Deploying** section as part of the
  cutover.
- The new repo has two references pointing outside itself: the home button's
  `../index.html`, and `../assets/games/<id>/<file>` in `data/themes.js`. Both
  still resolve once assembled at `/brackets/`, but neither can be tested from
  the brackets repo alone. Worth a note there if they ever start mattering.
