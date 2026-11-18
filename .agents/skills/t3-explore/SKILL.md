---
name: t3-explore
description: Research the current upstream and community state before discussing, planning, or implementing a new T3 Code feature. Check GitHub and public team posts, including X, to recommend reuse, waiting, adaptation, or building. Excludes routine bug fixes, releases, and maintenance of fork tooling.
---

# Explore before building

Run this research before choosing an implementation for a new T3 Code feature,
including feature questions and proposals without an implementation request.
Research is read-only; it does not authorize contacting maintainers, commenting,
or starting implementation. An existing implementation request remains authorized.
An explicit user instruction to skip research takes precedence.

## Establish the question

Translate the request into observable behavior, affected clients/providers and
constraints. Search by that behavior and alternative terminology, not just the
user's proposed feature name: upstream may solve the same problem differently.
Read `FORK.md` and relevant local code to distinguish missing functionality from
an existing setting, a fork difference, or a feature absent only from this checkout.

## Investigate current sources

1. Establish the upstream repository from remotes and `FORK.md` (normally
   `pingdotgg/t3code`). Record the research date and inspected upstream revision.
   Inspect current upstream code/history for relevant behavior; an installed
   build and the fork's merge base do not establish upstream's current state.
2. Search upstream issues, discussions, and **open and closed PRs**, using several
   behavioral terms. Follow duplicates, linked PRs/issues and replacement work.
   Read relevant bodies, latest comments and review conversations. Check whether
   closed PRs were merged, rejected, abandoned, or superseded, and whether merged
   work reached a release. Trace partial implementations and client/provider gaps.
3. Establish maintainer awareness from direct evidence: acknowledgements, design
   comments, assignments, authored work, project/roadmap entries or explicit plans.
   Identify people and their role from current official repository/team sources.
   Assignment or acknowledgement alone does not prove active work or a delivery
   commitment. Read linked follow-ups before treating an old plan as current.
4. Search the public web and X for the feature and related terms, including posts
   by the maintainers identified above and official project accounts. Follow
   relevant posts, threads, demos and linked repositories. Compare publication
   dates with GitHub activity; a teaser may describe work already shipped or
   since abandoned. Open primary sources rather than relying on search snippets.
5. Investigate relevant community PRs, forks and alternative tools for approaches
   that could inform this feature. Start with work surfaced by the searches;
   expand when it offers a concrete design or implementation lesson. Inspect
   source/demo evidence and constraints before recommending reuse. Check license
   compatibility before copying code; screenshots alone establish no implementation.

Use available connected GitHub tools for repository evidence and web search for
public sources. If a tool lacks a needed capability, use another available
read-only path, such as `gh` or Git. X may require login or be poorly indexed:
try publicly accessible/search-indexed posts and linked official sources, then
state what remained inaccessible. Never invent handles, posts, ownership or plans.

Finish when each source category above has been checked or explicitly marked
unavailable, relevant linked work is resolved to its latest known state, and
additional search terms stop adding material evidence. Deep research means
following the evidence, not accumulating unrelated links. Report coverage gaps;
“no matching public evidence found” is not “nobody is working on it.”

## Recommend a course

Give a dated synthesis with direct source links and dates for material claims:
what exists, relevant open/closed work and its status, maintainer awareness or
ownership, public plans, community lessons, and remaining unknowns. Separate
confirmed facts from inference. For conflicting evidence, explain which is newer
or more direct and what cannot yet be resolved. Keep useful search terms and
coverage limits in the report so negative findings are assessable.

Recommend based on the requested behavior:

- **Reuse upstream:** the behavior already exists; identify its revision/release,
  coverage and whether this fork has it.
- **Wait:** directly evidenced active upstream work covers the need; explain
  remaining gaps and uncertainty. Give timing only when a source commits to it.
- **Adapt:** existing upstream/community work covers part of the need; identify
  reusable ideas, missing behavior and likely integration costs.
- **Build:** evidence does not justify waiting or available approaches miss the
  requirement; propose the smallest useful change and upstream overlap to track.

Acknowledge tradeoffs when evidence supports several options. Waiting is advice,
not a silent cancellation of an implementation request. Present the findings
before editing product code, then continue authorized work using
[t3-fork-feature](../t3-fork-feature/SKILL.md), unless a material product decision
requires the user's answer. For exploration-only requests, stop at the findings.
Reuse research already completed in this thread for the same scope; refresh
changing statuses before implementation when time has passed or new evidence
appears. Keep reports in the conversation or outside the worktree unless the
user explicitly requests a tracked research artifact.
