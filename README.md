# Multilingual TTS

Read Obsidian notes aloud **in the language they are written in**. Select a French paragraph and it is read by your French voice; select an English one and it is read by your English voice — without changing a setting in between.

This is built for vaults that mix languages: language notes, translation work, research in a second language, or anyone whose notes simply aren't all in one language.

## Features

- **Language auto-detection** — the language of the selection decides the voice, with a manual override always available.
- **Voice profiles** — named, described, reorderable configurations of language, voice, speed, pitch, volume, and (on Azure) speaking style and role. Set up "French narrator — slow, for articles" once and pick it by name, or let detection choose for you.
- **Two speech engines** — your device's built-in voices (free, offline, no account) and Azure Speech (high quality, expressive styles).
- **Several providers at once** — add as many Azure resources as you like, each with its own key, region, voice list and storage mode. A profile picks one by name, and you can refresh one voice list or all of them.
- **Per-profile output folders** — the French profile can file its audio under `Audio/French/` while everything else uses the global default.
- **Right-click a word** — read it, or save the audio, or save it and turn the word into a link to that audio. You choose which of the three the menu offers.
- **Template file names** — audio is named after the words you read, and you can rename it with the same variables as the Obsidian Templates plugin, globally or per profile.
- **Save to audio files** — writes into your vault (so it works on mobile) and can insert a playable embed at the cursor.
- **Long notes** — text is split at sentence boundaries, so playback starts after the first chunk rather than the whole note, and files longer than one request are joined into a single file.

## Installation

Not yet in the community plugin list. Install it one of these two ways.

**With [BRAT](https://github.com/TfTHacker/obsidian42-brat)** — add `SevenNateNine/obsidian-multilingual-tts` as a beta plugin, and BRAT handles updates.

**Manually** — download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/SevenNateNine/obsidian-multilingual-tts/releases), put them in `<vault>/.obsidian/plugins/multilingual-tts/`, then enable the plugin under **Settings → Community plugins**.

## Setup

Settings has two tabs. **General** holds the profiles and everything about reading and saving. **Providers** holds the speech engines and their credentials.

1. Enable the plugin. A starter profile is created from your device's default voice, so **Read selection** works immediately.
2. Optionally open **Providers → Add provider**, choose Azure Speech, enter a key and region, then press **Refresh** on its row.
3. Add profiles under **General → Voice profiles → Add profile**.

## Providers

A provider is one configured speech engine. **System voices** is always there and needs nothing. Every other provider is one account that you add yourself, so two Azure resources in two regions are two providers, each with its own voice list.

Each row shows what its voice list holds and how old it is. **Refresh** reloads one provider. **Refresh all** reloads every provider that can be reloaded, and skips any that is locked or has no credentials yet.

Deleting a provider leaves the profiles that used it alone rather than moving them to another engine. Those profiles are marked in the list and say so if you try to read with them, so adding the provider back restores them.

### Azure

Azure Speech has a free tier. Create a Speech resource in the Azure portal and copy the key and region from its **Keys and Endpoint** page.

#### How the key is stored

Obsidian keeps plugin settings in a plain `data.json`. That file travels with your vault, so a synced vault syncs the key too. Each provider has its own **Key storage** setting, in its editor, controlling what the file actually holds for that provider.

| Mode                        | What it does                                       | What it protects against                                                                    |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Plain text                  | Writes the key as you typed it.                    | Nothing.                                                                                    |
| Obfuscated _(default)_      | Encodes the key so it is not readable at a glance. | A screenshot, a glance over your shoulder, a `data.json` pasted into a bug report.          |
| Encrypted with a passphrase | AES-GCM, with the passphrase stretched by PBKDF2.  | A copy of `data.json` in someone else's hands, through sync, a backup, or a git repository. |

Obfuscated is encoding, not encryption. Anybody who wants the key can reverse it in a few seconds. It is there to stop an accidental leak, not an attacker. This is the same level of protection that [Remotely Save](https://github.com/remotely-save/remotely-save) applies to its own settings file.

Passphrase mode is real encryption. Each provider has its own passphrase, and you enter it once per session, the first time something needs that provider. The passphrase is never written to disk. If you forget it, nothing can recover the key, and you must paste it again from the Azure portal.

None of the three modes protect against software that already runs on your machine.

## Commands

| Command                      | What it does                                                |
| ---------------------------- | ----------------------------------------------------------- |
| Read selection               | Reads using the auto-detected or default profile            |
| Read selection with profile… | Fuzzy picker showing each profile's name and description    |
| Convert text to audio…       | Dialog to edit the text, choose a profile, and play or save |
| Switch default voice profile | Changes which profile is the default                        |
| Pause or resume              | Toggles playback                                            |
| Stop                         | Stops playback and cancels pending synthesis                |

With nothing selected, **Read selection** can read everything before or after the cursor — see **Reading → With no selection, read**.

## Context menu

Right-click a selection and the plugin offers three actions, grouped together:

| Item                      | What it does                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| Read selection            | Plays it                                                                 |
| Read and save audio       | Plays it and writes the audio into your vault                            |
| Read, save and link audio | The same, and replaces the selected words with a link to the saved audio |

Turn each item on or off under **Settings → General → Context menu**. All three are on to start with.

**Link style** decides what replaces the words:

| Style                 | Result                     |
| --------------------- | -------------------------- |
| Wikilink (default)    | `[[Audio/안녕.mp3\|안녕]]` |
| Markdown link         | `[안녕](Audio/안녕.mp3)`   |
| Player after the word | `안녕 ![[Audio/안녕.mp3]]` |

A wikilink is the default because Obsidian rewrites it when the audio file is moved or renamed. A word containing `[`, `]` or `|` cannot be wikilink text, so it gets a markdown link instead.

The two saving actions render the audio once and play that file, rather than speaking the text and then paying for the same synthesis a second time. The cost is that playback starts after the whole selection is rendered. For a word this is not noticeable. For a long paragraph, plain **Read selection** starts sooner, because it plays the first chunk while it renders the next.

A profile on the device voices cannot write a file. Those two actions report that and save nothing.

## Auto-detection

Detection compares the selected text only against the languages your own profiles cover, which is far more reliable on a short selection than open-world language identification.

It needs profiles in **at least two languages** to have anything to choose between; the settings tab says so explicitly when it can't work. Selections shorter than the minimum length use the default profile rather than guessing.

The minimum length does not apply to a script that only one language uses — Korean, Chinese, Japanese, Thai, Greek and others. A single character in one of those is already conclusive, so it is detected whatever the minimum is set to. The minimum applies to Latin, Cyrillic, Arabic and Devanagari, where several languages share one script and only whole words tell them apart.

Profiles can opt out individually with **Use for auto-detection**. A language with no opted-in profile is never detected, however clear the script is — the selection falls back to the default profile instead. When two profiles share a language, the one higher in the settings list wins.

## Output folders

Saved audio goes to the **Default save folder**. A profile can override this with its own folder — leave a profile's folder empty to inherit the default. Missing folders are created automatically, and an existing file is never overwritten: a numeric suffix is added instead.

Paths are relative to the vault root. Absolute paths are rejected, because writing outside the vault is what makes saving desktop-only.

## File names

By default each file is named after the words you read, so reading "hey" writes `hey.mp3`. Reading the same words again does not overwrite it: the second file becomes `hey-1.mp3`.

**Settings → General → Output → File name template** changes that. It is written in the [template variables](https://obsidian.md/help/plugins/templates#Template+variables) of the Obsidian Templates plugin, so a format string you already use elsewhere behaves the same here.

| Variable                      | Expands to                                           |
| ----------------------------- | ---------------------------------------------------- |
| `{{title}}`                   | The name of the note you are reading from            |
| `{{date}}`, `{{date:FORMAT}}` | The date, in Moment.js tokens. Default `YYYY-MM-DD`  |
| `{{time}}`, `{{time:FORMAT}}` | The time. Default `HH-mm-ss`                         |
| `{{selection}}`               | The words being read, up to 40 characters            |
| `{{property:name}}`           | A property of the note, or its name if there is none |
| `{{profile}}`, `{{locale}}`   | The name and language of the voice profile           |
| `{{default}}`                 | The name this template extends — see below           |

`{{time}}` defaults to `HH-mm-ss` rather than Obsidian's `HH:mm`, because a colon cannot appear in a file name. A colon in a format you type is removed for the same reason.

A filter after a bar changes the case of what a variable produces. It applies to the whole value, including the note name a missing property falls back to. For a property set to `you can do this later`:

| Filter                                  | File name                   |
| --------------------------------------- | --------------------------- |
| `{{property:natural-language\|kebab}}`  | `you-can-do-this-later.mp3` |
| `{{property:natural-language\|snake}}`  | `you_can_do_this_later.mp3` |
| `{{property:natural-language\|camel}}`  | `youCanDoThisLater.mp3`     |
| `{{property:natural-language\|pascal}}` | `YouCanDoThisLater.mp3`     |

A word is a run of letters or digits in any script, so Korean or Chinese text keeps its characters and only the spaces and punctuation change. A format and a filter combine as `{{date:YYYYMMDD|kebab}}`.

A profile can set its own template under **Edit profile → Output → File name template**, and an empty one inherits the global template. `{{default}}` stands for the template one level up, so you can extend a name instead of repeating it:

| Profile template           | Result                     |
| -------------------------- | -------------------------- |
| `{{default}}_drill`        | Appends to the global name |
| `KR_{{default}}`           | Prepends to it             |
| `{{selection}}_{{locale}}` | Replaces it completely     |

That is how one global template names files for every language. Set the global template to `{{property:natural-language|kebab}}`, give the Korean profile `kr_{{default}}` and the Cantonese profile `hk_{{default}}`, and a note with `natural-language: you can do this later` writes `kr_you-can-do-this-later.mp3` from one voice and `hk_you-can-do-this-later.mp3` from the other.

Illegal characters are removed from the finished name, and an existing file is never overwritten: a numeric suffix is added instead.

### Naming files after a note property

`{{property:name}}` reads a property from the frontmatter of the note you are reading. This is the useful one for a vocabulary vault, where the note already records the word, the lesson, or the unit.

Take a note with this frontmatter:

```yaml
---
word: annyeong
lesson: 4
tags:
  - greeting
  - polite
---
```

| Template                                | File name             |
| --------------------------------------- | --------------------- |
| `{{property:word}}`                     | `annyeong.mp3`        |
| `KR-{{property:word}}`                  | `KR-annyeong.mp3`     |
| `{{property:word}}-{{property:lesson}}` | `annyeong-4.mp3`      |
| `{{property:tags}}`                     | `greeting-polite.mp3` |

Three rules make this predictable:

- **A list becomes dash-separated.** `tags` above gives `greeting-polite`. Only the top level of a list is read, so a list inside a list adds nothing.
- **A missing property falls back to the note name.** If that note had no `word` property, `KR-{{property:word}}` would write `KR-Korean vocabulary.mp3`, taking the name of the note itself. A property that exists but is empty falls back the same way, so you never get a name with a hole in it. Turn on **Ask for a missing property** to be asked instead — see below.
- **Everything outside the braces is written as it stands.** That is how you prepend characters and separate parts with dashes: `KR-{{property:word}}-{{date:YYYYMMDD}}` writes `KR-annyeong-20260818.mp3`.

Set this globally under **Settings → General → Output → File name template**, where the field shows an example built from the note you have open, or per profile so that only your Korean voice names files this way.

### Being asked for a missing property

Falling back to the note name is quiet, which is right when it happens rarely and wrong when you meant to fill the property in. **Settings → General → Output → Ask for a missing property** changes that: a dialog opens naming each property the note does not have, with a field for each one.

- Type a value and the name uses it. Nothing is written back to the note — this names the audio only.
- Leave a field empty and that property falls back to the note name, exactly as it does with the option off.
- Close the dialog and nothing is saved. The dialog opens before any audio is rendered, so cancelling costs nothing.

The dialog only appears when a template actually asks for a property the note lacks. A template with no `{{property:...}}` in it never opens one.

This applies to the two saving actions in the right-click menu. **Convert text to audio…** does not use it, because that dialog already shows the file name in a field you can edit.

## Development

```bash
npm install && npm run dev
```

`npm run dev` rebuilds `main.js` in place on change. Reload Obsidian (or use the Hot Reload plugin) to pick up a build.

```bash
npm run build   # typecheck, then a production bundle
npm test        # unit tests
npm run lint
```

`src/` is split by dependency direction. `core/` holds the decisions and imports no framework, no speech SDK and no language model — a lint rule fails the build if it ever does. `adapters/` holds the implementations of those decisions (Obsidian, Azure, the Web Speech API, franc), and `ui/` holds the Obsidian screens. `main.ts` wires them together.

Adding a speech engine is three edits: an entry in `core/tts/providerTypes.ts` describing its name and credential fields, a class in `adapters/` implementing `RenderingProvider` or `SpeakingProvider`, and one branch in the factory in `main.ts`. Nothing in `ui/` names an engine, so the settings screen and the profile editor pick it up on their own.

Tests cover the logic that is easy to get quietly wrong: markdown stripping, XML escaping, SSML capability gating, text chunking, WAV concatenation, language mapping, path resolution, settings migration, key encoding and decoding, the chunk prefetch during playback, and every way a read or a save can be refused. They run without Obsidian — `vitest.config.ts` aliases the `obsidian` module to a stub, and the layer split means the playback and conversion flows are testable with fakes rather than a live vault.

## Credits

The markdown-stripping approach and the read-before/after-cursor behaviour are adapted from [luhaifeng666/obsidian-text2audio](https://github.com/luhaifeng666/obsidian-text2audio) (MIT).

## License

MIT
