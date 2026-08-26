---
name: react-vite-feature-slice
description: Add or change a user-facing feature in the React 19 + TypeScript 6 + Vite 8 web client as a self-contained vertical slice - component, route, data access, state, types and tests - without leaking secrets or hardcoding environment values. Use when the task mentions a React component, page, route, hook, form, client-side state, API call from the browser, Vite config, or a frontend build/env problem.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code and requires no packages. Written
  for the consuming repository's real web client, which pins React 19.2.7,
  TypeScript 6.0.3 and Vite 8.1.0. Those anchors were read from its lockfile
  on 2026-08-26, not built or tested here. No agent benchmark has been run.
  Volatile facts are not asserted - retrieve them live per the AGENTS.md
  live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: web
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "react and react-dom 19.2.7, TypeScript 6.0.3, Vite 8.1.0, @vitejs/plugin-react 6.0.3 (read from the consuming repository web/package-lock.json on 2026-08-26, not built or tested here)"
  behaviour-verified: "none - no agent benchmark has been run (see COMPATIBILITY.md)"
  volatile-facts: "not asserted here, retrieve live per the AGENTS.md live-doc policy"
---

# React + Vite feature slice

Deliver frontend change as one coherent slice under a single feature folder
so it can be reviewed, tested and reverted as a unit.

## Before you start

Confirm from the consuming repository — not from memory:

- The exact React, TypeScript and Vite versions in `package.json`, and the
  package manager lockfile in use.
- Whether routing, data fetching and form libraries are already chosen.
  **Use what is there.** Do not introduce a competing library.
- The existing feature folder layout. Mirror it.

If any of those are ambiguous, ask before writing code.

## Procedure

1. **Locate or create the slice folder**, e.g.
   `src/features/<feature>/` containing `components/`, `api/`, `model/`
   (types + validators), `hooks/`, and colocated tests. Nothing outside the
   folder should need to change except a route registration and, rarely, a
   shared type.
2. **Define the contract first.** Write the TypeScript request/response
   types and a runtime validator for anything crossing the network boundary.
   Server shapes are untrusted input; a compile-time type alone is not
   validation.
3. **Write the data-access function** in `api/`. One function per endpoint.
   It takes typed input, returns typed output, throws a typed error. No
   component calls `fetch` directly.
4. **Build the component** as a pure render of props plus one data hook.
   Keep server state in the repo's data-fetching layer and local UI state in
   `useState`/`useReducer`. Do not mirror server state into a global store.
5. **Handle the three states explicitly** — loading, empty, error — before
   the success path. An unhandled error state is an incomplete slice.
6. **Register the route** and any lazy boundary. Confirm the code-split
   boundary matches how the route is actually reached.
7. **Test the slice**: one test per rendered state and one for the data
   function's error path. Assert user-visible behaviour, not internals.
8. **Read config from `import.meta.env`** with a `VITE_`-prefixed name, via
   a single typed config module. Never inline a URL, tenant, or key.

## Decision points

| Situation | Decision |
| --- | --- |
| Needs data the API does not expose | Stop. Route to `aspnetcore-endpoint-slice` first; do not shape the API from the client. |
| Needs a secret, key or client credential in the browser | Not possible. Anything shipped to the browser is public. Move the call server-side and route to `secure-by-design-review`. |
| Needs a new dependency | Justify against what is already installed. Prefer none. If required, record why in the PR description. |
| Needs environment-specific behaviour | Use a `VITE_`-prefixed build-time variable set per environment; never branch on hostname. See `../../../references/environments.md`. |
| State is shared by two unrelated routes | Lift to the existing shared layer only; do not create a second global store. |
| Bundle grows noticeably | Split at the route boundary before reaching for a bundle analyser rewrite. |

## Verification

Run in the consuming repo (confirm exact script names first):

```bash
npm ci
npm run lint
npm run build          # type errors must fail the build
npm run test
```

Then check by hand:

- Loading, empty and error states each render without a console error.
- No `VITE_`-prefixed value contains anything secret — every one of them is
  shipped to the browser in plain text.
- `git diff --stat` shows changes confined to the feature folder plus the
  route registration.
- No new `any`, no `@ts-expect-error` without an adjacent reason comment.

## Failure handling

| Symptom | First action |
| --- | --- |
| Type error only in `npm run build`, not in the editor | The editor and CI are using different TypeScript versions or `tsconfig` projects. Trust the build. |
| `import.meta.env.X` is `undefined` at runtime | The variable lacks the `VITE_` prefix, or was added after the build started. Vite inlines env at build time; rebuild. |
| Works locally, 404s on the deployed site | Client-side routing without a server rewrite to `index.html`. Route to `azure-appservice-deploy`. |
| CORS error against the API | Do not "fix" it in the client. Route to `aspnetcore-endpoint-slice`. |
| Dependency install differs from CI | Use `npm ci`, not `npm install`, and do not edit the lockfile by hand. |

If the fix is not obvious within two attempts, stop and report what you
observed rather than broadening the change.

## Live retrieval required

Do **not** state from memory: React/TypeScript/Vite version-specific API
behaviour, current Vite config option names, or browser support matrices.
Retrieve live per the live-doc policy in `../../../AGENTS.md`, using the
React, TypeScript and Vite entries in `../../../references/links.md`.
