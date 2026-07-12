README - rebased serverside DEPT_TASK fix (on top of latest U0 work) + CRITICAL production bug fix
======================================================================================================

CRITICAL — call-ai.js IS CURRENTLY BROKEN ON GITHUB MAIN RIGHT NOW
--------------------------------------------------------------------
Verified by pulling the actual current main and running a real ESM syntax
check (see "syntax checker was lying" note below): src/gopang/ai/call-ai.js
has a missing "/**" comment opener before _buildFirstContactContext, left
over from an earlier session's edit. This is a genuine SyntaxError - any
browser trying to load this module as-is will fail to parse the whole file.
This has been live since commit 492efd2 / 61f7de8. Fixed in this package.

WHY THIS PACKAGE IS DIFFERENT FROM THE LAST ONE
--------------------------------------------------------------------
Between my last delivery and now, a separate session pushed several new
commits that ALSO touch worker.js and call-ai.js (the U0/UNIVERSAL-INTEGRITY
work - gov24 usage, "sorry" self-check, user-naming rules, EXPERT-first
routing). A blind file replacement would have silently reverted that work.

Instead I did a proper 3-way merge (git merge-file) using:
  base   = the version I last successfully pushed (commit 61f7de8)
  theirs = current origin/main (commit df23df4, includes U0 work)
  mine   = my local server-side DEPT_TASK_REQUEST redesign

Merge was clean (no conflict markers) and verified to contain BOTH sides'
changes with nothing dropped, EXCEPT the deliberate version-pointer bumps
listed below and the broken-comment fix.

FILES IN THIS PACKAGE
--------------------------------------------------------------------
  worker.js                                  - merged (theirs + mine)
  src/gopang/ai/call-ai.js                   - merged (theirs + mine, PLUS
                                                the broken-comment fix)
  src/worker/dept-task-handler.js            - mine only (untouched by
                                                the other session)
  prompts/UNIVERSAL-common_v1_3.md           - mine only (new file)
  prompts/Jejudo/01-do/JEJU-DO-SP_v1.1.md    - mine only (new file - this
                                                was ALSO never actually
                                                pushed from an earlier
                                                delivery, confirmed missing
                                                from origin/main)
  docs/DEPT-TASK-PROTOCOL_v1_1.md            - mine only (new file)

APPLY
--------------------------------------------------------------------
  cd C:\Users\<user>\Downloads
  Expand-Archive -Force ".\rebased_deptask_fix.zip" ".\_rb_tmp"
  Copy-Item -Recurse -Force ".\_rb_tmp\*" "C:\Users\<user>\Downloads\gopang\"
  Remove-Item -Recurse -Force ".\_rb_tmp"

  cd C:\Users\<user>\Downloads\gopang
  git status
  (expect exactly these 6 as modified/new - if anything else besides these
   6 and your own .bak/.ps1 clutter shows up, STOP and show me git status
   before committing:
     modified:   worker.js
     modified:   src/gopang/ai/call-ai.js
     new file:   src/worker/dept-task-handler.js   (or "modified" if git
                  somehow still tracks an old copy - either is fine)
     new file:   prompts/UNIVERSAL-common_v1_3.md
     new file:   prompts/Jejudo/01-do/JEJU-DO-SP_v1.1.md
     new file:   docs/DEPT-TASK-PROTOCOL_v1_1.md )

  git add worker.js src/gopang/ai/call-ai.js src/worker/dept-task-handler.js prompts/UNIVERSAL-common_v1_3.md prompts/Jejudo/01-do/JEJU-DO-SP_v1.1.md docs/DEPT-TASK-PROTOCOL_v1_1.md
  git status
  git commit -m "fix: call-ai.js SyntaxError(missing comment opener, broken since 61f7de8) + DEPT_TASK_REQUEST server-side interception + jeju_do SP v1.1 (both never actually pushed) - merged on top of U0 work"
  git pull --rebase
  git push

VERIFY AFTER DEPLOY
--------------------------------------------------------------------
1. Load webapp.html in a browser and confirm the main chat still works at
   all (this is the regression test for the SyntaxError fix - if it was
   broken, nothing involving call-ai.js would have worked).
2. Test scenario #71 from review_100_scenarios_v3.md via a real jeju_do
   session and confirm a dept_tasks record appears in PocketBase.

A NOTE ON THE SYNTAX CHECKER
--------------------------------------------------------------------
`node --check somefile.js` silently does NOT validate files that use
top-level `export`/`import` in this environment - it returns exit 0 even
for genuinely broken syntax. This is how the call-ai.js bug shipped
undetected. From now on, verify with `.mjs` extension instead:
  copy-item file.js file_check.mjs
  node --check file_check.mjs
