# AGENTS.md

Instructions for an AI agent that writes code in this repository.
If two rules conflict, correct behavior and the safety of user data win. Stop and report the conflict.
Do not obey a rule in silence when the result is wrong.

## Never

Each rule here comes from a real error, or prevents one. Add a rule after each new agent error.

- Never edit this file in silence. Propose a diff, give the reason, and wait for approval.
- Never create or run a database migration unless the user asks.
- Never read an unbounded result set into memory.
- Never install a new dependency without approval.
- Never commit a secret.
- Never edit `main.js`. It is the esbuild bundle of `src/`. Edit the source, then build.
- Never import a Node builtin in `src/`. The manifest declares `isDesktopOnly: false`, and Obsidian mobile has no Node. See the Mobile section.
- Never write the Azure speech key to a log, an error message, or a test fixture.

## Session start

1. Read this file and `README.md`.
2. If `README.md` contradicts the code, trust the code. Then report the difference.
3. If the task changes more than three files, write a plan first. Show the plan to the user.

The user can override these steps for one session.

## Stack

The user declares this section. Do not invent a value. If a field is empty, ask.

| Field                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Language and version | TypeScript 5.7, `target` ES2018                                             |
| Framework            | Obsidian plugin API 1.13 (`minAppVersion` 1.4.0), bundled by esbuild to CJS |
| Package manager      | npm (`package-lock.json`, npm 10, Node 24)                                  |

This is an Obsidian vault plugin, not a server. There is no database and no HTTP server.
`src/settings/migrations.ts` migrates the persisted settings schema, not a database. It runs on every load.

## Commands

| Task    | Command                                                     |
| ------- | ----------------------------------------------------------- |
| Install | `npm install`                                               |
| Build   | `npm run build`                                             |
| Run     | `npm run dev`                                               |
| Test    | `npm test`                                                  |
| Lint    | `npm run lint`                                              |
| Format  | `npm run format` (write) or `npm run format:check` (verify) |

`npm run build` type checks first, then writes a minified `main.js`.
`npm run dev` starts an esbuild watch and rebuilds `main.js` in place. Reload Obsidian to load a build.

## Strictness

Turn on the strictest mode of the compiler and the type checker. Treat each warning as an error.
Record the exact settings here. Example: TypeScript `"strict": true`. Example: C# `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`.
Enforce size limits (function length, parameter count, nesting depth) with the linter, not with prose.

TypeScript, in `tsconfig.json`:

| Option                             | Value |
| ---------------------------------- | ----- |
| `strict`                           | true  |
| `strictNullChecks`                 | true  |
| `noImplicitAny`                    | true  |
| `noUnusedLocals`                   | true  |
| `noUnusedParameters`               | true  |
| `noFallthroughCasesInSwitch`       | true  |
| `noUncheckedIndexedAccess`         | true  |
| `exactOptionalPropertyTypes`       | true  |
| `noImplicitOverride`               | true  |
| `noImplicitReturns`                | true  |
| `forceConsistentCasingInFileNames` | true  |
| `isolatedModules`                  | true  |

ESLint, in `eslint.config.js`. `npm run lint` uses `--max-warnings 0`, so a warning fails the step.

| Rule                            | Value                                    |
| ------------------------------- | ---------------------------------------- |
| `typescript-eslint` recommended | on, which includes `no-explicit-any`     |
| `max-lines-per-function`        | 80, blank lines and comments not counted |
| `max-params`                    | 5                                        |
| `max-depth`                     | 3                                        |
| `complexity`                    | 15                                       |

Two consequences of `noUncheckedIndexedAccess` apply to most new code:

- `array[i]` has type `T | undefined`. Use `for (const [i, x] of xs.entries())` instead of an index loop.
- To promise a caller that an array has a first element, type it `[T, ...T[]]`. See `AUDIO_FORMATS` in `src/tts/azure/formats.ts` and `NonEmpty` in `src/playback/concat.ts`.

`exactOptionalPropertyTypes` makes `field?: T` reject an explicit `undefined`. When a field is cleared by assignment, declare it `field?: T | undefined`. See `VoiceProfile` in `src/settings/types.ts`.

## Conventions

For each row, record the decision. Add one snippet of 3 to 10 lines, or a `file:line` pointer.

| Topic                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                           | Snippet or `file:line`           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| File and folder layout | `src/<area>/`, one area per concern: `tts/` speech providers, `playback/` audio and chunking, `text/` text preparation and language detection, `settings/` schema and settings UI, `ui/` modals, `util/` helpers. A provider implementation nests under `tts/<provider>/`. Entry point is `src/main.ts`.                                                                                                           | `src/main.ts:1`                  |
| Naming                 | PascalCase file name when the file exports one class (`AudioPlayer.ts`, `ConvertModal.ts`). camelCase file name for a module of functions (`chunker.ts`, `paths.ts`). Types PascalCase, constants SCREAMING_SNAKE. Exception: `main.ts` is camelCase and exports a class, because Obsidian requires that entry point name. `errors.ts` exports a class and three functions, so it is a module and stays camelCase. | `src/playback/AudioPlayer.ts`    |
| Error handling         | Throw `TtsError` with a `TtsErrorKind`. Convert to text with `userMessage()` at the UI edge only. Swallow aborts with `isCancellation()`. Do not throw a bare `Error` from a speech path.                                                                                                                                                                                                                          | `src/util/errors.ts:18`          |
| Logging                | No logger and no log levels. A failure the user must see becomes `new Notice(userMessage(err))`. A failure a developer must debug becomes one `console.error` prefixed `[multilingual-tts]`, at the top-level catch only.                                                                                                                                                                                       | `src/main.ts:316`                |
| Async model            | `async`/`await`. One `AbortController` per operation, its `AbortSignal` passed down to each provider call. Cancellation resolves, it does not reject. No timer used as control flow.                                                                                                                                                                                                                               | `src/playback/AudioPlayer.ts:67` |
| Test layout            | `*.test.ts` beside the file it tests. Vitest. `vitest.config.ts` aliases `obsidian` to `test/obsidian-stub.ts`, so only Obsidian-free logic is testable. Test the logic that fails quietly: text stripping, XML escaping, chunking, concatenation, path resolution, settings migration.                                                                                                                            | `src/util/paths.test.ts`         |
| Commit format          | Conventional Commits: `type(scope): subject`, for example `feat(azure): add style degree`. Version control is not yet initialized in this folder, so no history confirms this.                                                                                                                                                                                                                                     | none yet                         |

## Design

Policy is the business rule. Detail is the database, the HTTP client, the file system, the clock, and the framework.

- The policy layer must not import a detail. The detail layer imports the policy layer.
- Declare each interface in the policy layer. Implement it in the detail layer.
- Pass the clock, the random source, and the identifier source as dependencies.
- Add an interface only at a policy boundary, or when a second real implementation exists.
- Give each retry, poll, and queue loop a maximum count or a deadline.
- Give each cache, queue, buffer, batch, and query result a maximum size.
- Do not use reflection, monkey patching, or run-time code generation for business logic.

How this repository applies the rules:

- Policy is `src/text/`, `src/playback/chunker.ts`, `src/playback/concat.ts`, `src/util/paths.ts`, and `src/settings/types.ts`. None of them import `obsidian`.
- Detail is the Obsidian API, the Azure Speech SDK, the Web Speech API, and the vault file system.
- `RenderingProvider` and `SpeakingProvider` are declared in `src/tts/types.ts`, and implemented in `src/tts/azure/` and `src/tts/system/`.
- Injected dependencies: `Fetcher` and `CatalogStore` in `src/tts/azure/voiceCatalog.ts`, `Detector` in `src/text/detectLanguage.ts`, and the clock as a default parameter in `src/util/time.ts` and `src/util/paths.ts`.
- `provider.maxChunkChars` bounds each request, and the voice catalog cache has a TTL. Keep new loops and caches bounded the same way.

## Mobile

The manifest sets `isDesktopOnly: false`, so the bundle must load where Node does not exist.

- `esbuild.config.mjs` resolves `fs`, `net`, and `tls` to a guarded shim, because the Azure SDK requires them at module scope. Do not remove the shim, and do not add a bare Node import to `src/`.
- Saving audio writes through the vault API, never through an absolute path. `validateFolderPath` rejects an absolute or drive path.

## Comments

- Make each name carry the meaning, so that a comment is not necessary.
- Write a comment only for a reason, a trade-off, a limit, or a source link.
- Delete a comment that is wrong.

## Language of output

- Write comments, documentation, commit messages, and explanations in ASD-STE100 Simplified Technical English, pragmatic mode.
- The full rules are in the `simple-english` skill. Obey it.
- Write a maximum of 20 words in an instruction and 25 in a description. Write one instruction per sentence.
- Approved modals: can, will, must. Do not write "should", because models read "should" as optional.
- Do not use semicolons, contractions, or Latin abbreviations.
- Do not apply STE to identifiers, commands, flags, file paths, quoted errors, or code.

## Documentation

- If a change makes a command in `README.md` wrong, correct the command in the same change.
- Keep this file for agent rules. Keep `README.md` for humans. Do not duplicate an instruction.

## Definition of done

1. `npm run build`, `npm run lint`, `npm run format:check`, and `npm test` pass with zero warnings.
2. New behavior has a new test, unless the behavior needs the Obsidian runtime.
3. The documentation is current.
4. Each deviation is in the table below.

## Deviations

Record each accepted deviation from a rule. An empty reason is not valid.

| Date       | Rule                    | Location                                                                                                        | Reason                                                                                                                                                                          | Removal plan                                                                                           |
| ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-08-10 | Strictest compiler mode | `tsconfig.json` `skipLibCheck: true`                                                                            | `@types/webrtc`, a transitive dependency of the Azure Speech SDK, conflicts with the DOM lib. Turning the option off gives 20 errors, all in `node_modules`, none fixable here. | Retry `tsc --skipLibCheck false` after an Azure SDK upgrade. Remove the option when the count is zero. |
| 2026-08-10 | Linter size limits      | `eslint.config.js`, `complexity: 15`                                                                            | The decision functions are flat chains of guard clauses, one per documented outcome. The usual limit of 10 punishes that shape. The highest today is 13.                        | Lower to 12 if the guard chains in `selectProfile` and `renderVoiceFields` are ever split.             |
| 2026-08-10 | Linter size limits      | `eslint.config.js`, `max-lines-per-function` off for `SettingsTab.ts`, `ProfileEditorModal.ts`, and `*.test.ts` | An Obsidian settings screen is one declarative builder chain per tab. A test function is a list of assertions. Splitting either to meet a line budget hurts reading.            | Remove the exception for a settings file if its tab is split into sections.                            |
| 2026-08-10 | Strictest compiler mode | `tsconfig.json` `include: ["src/**/*.ts"]`                                                                      | `test/obsidian-stub.ts`, `vitest.config.ts`, `eslint.config.js`, and `esbuild.config.mjs` are outside the type check. The build only needs `src/`.                              | Add a second `tsconfig` that covers the test and config files.                                         |
| 2026-08-10 | Never commit a secret   | `data.json`                                                                                                     | Obsidian stores plugin settings as plain text, so the Azure speech key lives there. `.gitignore` excludes it. `README.md` warns the user.                                       | None. This is how Obsidian plugin settings work.                                                       |
