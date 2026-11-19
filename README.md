# Tayang Studio

Tayang Studio is a free, open-source desktop app that helps Indonesian creators make motion videos without writing prompts. It picks topics, writes scripts and handles the prompting, while the user's own AI agent (Claude Code, opencode, Gemini CLI, Codex, Antigravity CLI or any ACP agent) does the building.

## Install

macOS and Linux:

```
curl -fsSL https://studio.tayang.app/install.sh | sh
```

Windows (PowerShell):

```
irm https://studio.tayang.app/install.ps1 | iex
```

Both install the latest release and open it. Installed copies update themselves.

- **macOS:** the app goes into /Applications (or ~/Applications if /Applications isn't writable).
- **Linux (x86_64 and ARM64):** the `.deb` with apt, the `.rpm` with dnf, yum or zypper, or the AppImage in ~/.local/share/tayang-studio when there is no sudo. The AppImage needs FUSE 2.
- **Windows:** installs for your user only, so no admin is needed.

Options: `TAYANG_VERSION=0.0.2` installs that version. `TAYANG_INSTALL_DIR` sets the macOS folder. `TAYANG_LINUX_PACKAGE=deb|rpm|appimage` picks the Linux package. `TAYANG_NO_LAUNCH=1` skips opening the app. Or download an installer from [Releases](https://github.com/Maru-Yasa/tayang-studio/releases).

## Run it from source

```
pnpm install
pnpm dev:desktop
```

Requires Node 22+, pnpm and Rust. See [docs/development.md](docs/development.md) for the full setup, the API and where data lives.

On Linux the app runs on WebKitGTK 2.40 or later. On older versions it still works, but the preview panel always shows its narrow layout (short button labels, no frame chip, no key hints), because those layouts use CSS container queries.

## Layout

```
tayang-desktop/
├── apps/
│   └── desktop/   @tayang/desktop  Tauri + React desktop app
├── packages/
│   ├── shared/    @tayang/shared   Types and schemas shared across apps
│   └── skills/    @tayang/skills   Agent skills bundled with Tayang
├── docs/                           Spec and implementation plan
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm test` | `pnpm -r test` | Run tests in every workspace package |
| `pnpm typecheck` | `pnpm -r typecheck` | Type-check every workspace package |
| `pnpm dev:desktop` | `pnpm --filter @tayang/desktop tauri dev` | Run the desktop app in dev mode |

## How it works

- The agent runs over ACP. Tayang has no AI of its own: every generation goes through the agent you already use.
- Installs go through the agent too. Tayang shows you every command your agent asks to run, and nothing it asks about runs until you allow it, unless you turn on Auto mode for chats, you are copying a style from a video (a style study always runs in auto mode), or an autopilot is making a video (autopilots always run in auto mode). Installs always ask. An agent whose own settings already allow a command won't ask, so check your agent's permission settings (see `docs/development.md`).
- You pick a working folder. Projects live there and keep their folder if you change it later. Agent sessions work in the working folder or in a project's own folder.
- App data is stored in a local SQLite database, so the desktop app keeps its data on this computer and doesn't need the API (your agent still needs its own internet connection).
- The Tayang API (studio.tayang.app/api, closed source) is optional and only adds the online features: sign-in, paid plans, additional styles and install stats.

## Privacy

Tayang sends a random install ID, your system (macOS, Windows or Linux), its version, your computer's processor type and the app version once a day. Nothing about you or your videos. The API stores no IP address, name or path.

To turn it off, open Settings › Account and switch off "Share anonymous install stats".

Signing in is optional. Settings › Account › "Sign in with Google" opens your browser at the Tayang API (studio.tayang.app/api, or the API address you set), where you continue with Google. Google shares your email address and name with the Tayang API, which keeps them with your account and plan; nothing else from your Google account is asked for. The desktop app keeps a sign-in token in the OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux), tied to that API address. Only if this computer has no keychain at all does it keep the token in `auth.json` in the app's data folder, readable by your user only (other programs running as you, such as the agent CLIs, could still read it). If you deny Tayang access to the keychain, signing in stops with an error instead. Signing in needs an https API address (plain http only to this computer, for local development). The token is never shown in the app's window. It also caches your email, name and plan so the account still shows offline. "Sign out" revokes the token at the API when it can be reached and removes it from this computer.

Paid plans (Lite, Creator, Pro) are paid with QRIS through SumoPod, a payment service: "Pay with QRIS" opens SumoPod's payment page in your browser, and you pay there from your banking or e-wallet app. Tayang stores your plan, when it ends, and each payment's plan, amount, status and SumoPod payment ID. It never sees or stores card, bank or e-wallet details. The desktop app asks the Tayang API for your plan with your sign-in token, which stays out of the app's window, and remembers on this computer which period end it already reminded you about.

Gift codes (Settings › Account › "Have a gift code?") give one gift per account and one per computer per promo. To tell computers apart, redeeming a code sends the Tayang API a SHA-256 hash of your computer's machine ID (macOS IOPlatformUUID, Windows MachineGuid, Linux machine-id), never the ID itself, and the API hashes it again with its own secret before storing it with the gift. Nothing is sent for this until you redeem a code.

To show your Claude usage, Tayang reads the login Claude Code already stores on this computer and sends it only to Anthropic to fetch your usage numbers.

The Style screen loads YouTube thumbnails from i.ytimg.com for styles copied from YouTube, and built-in style previews from the Tayang API at studio.tayang.app/api. A style copied from a video keeps a short silent preview clip and a poster frame on this computer; the video itself is deleted after the study.

Set `TAYANG_API_URL` when starting the desktop app to point it at another API (a base with the path, e.g. `http://localhost:8787/api`); it is used as given instead of the saved API URL and never stored.

## Credits

The optional sound-effect search in Settings → Video defaults is an independent integration using Openverse. Agents send short search terms for CC0 Freesound recordings by default, verify the license at the original source, and record credits in `audio/sfx/CREDITS.md`. CC BY recordings are available when the user explicitly requests credits in the video or publication caption. [Openverse API](https://api.openverse.org/v1/)

Search works anonymously by default. To use authenticated rate limits, register an application with Openverse and verify the registration email. Enter its Client ID and Client Secret in **Settings → Video defaults → Openverse credentials**, then select **Save Openverse credentials**. Tayang verifies the pair with Openverse before saving it in the system keychain. Select **Remove Openverse credentials** to return to anonymous search. [Openverse registration and authentication](https://api.openverse.org/v1/#section/Register-and-Authenticate)

In a video chat, ask for natural foley or sound effects synced to the picture. Tayang's agent skill uses [Clipwing Real SFX](https://clipwing.pro/skills/real-sfx) to mix selected recordings and [Earshot](https://github.com/Leonxlnx/earshot) to compare candidates and review the mix locally. The tools work with both HyperFrames and Remotion. The agent asks before installing missing tools. Real SFX needs Python, FFmpeg and FFprobe. Earshot setup uses uv and CPU PyTorch. Basic measurements work without models or an API key, and the optional models for matching and reviewing audio take about 1.1 GB. The finished MP4 goes in `renders/`, with the cue report, separate effects track and recording credits under `audio/sfx/`. See the [Tayang agent workflow](packages/skills/agent-plugin/skills/tayang-studio/SKILL.md#real-sfx-mixing-and-earshot-review).

In **Settings → Video defaults → Voiceover**, choose **ElevenLabs** for Tayang credits or **Gemini TTS** for your own Google quota. Paste a [Gemini API key from Google AI Studio](https://aistudio.google.com/apikey) and save it. Tayang checks access and stores the key in the system keychain. The agent uses the same local `/voice` route and receives an MP3. One speaker uses Gemini 3.8 Live, as in QuickSpeak. Two speakers use Gemini 3.8 Flash TTS via Interactions, as in Native Speech Generation. Google receives the narration or dialogue. [Google Live API](https://ai.google.dev/api/live) · [Google speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)

Tayang bundles 66 visual styles adapted from [Lemo-Opuscar by LemoLab](https://github.com/lemomo-ai/lemo-opuscar/tree/143f387ad774525dc9abc0ff05fb5f4bfbaa5f02) under the [MIT license](apps/desktop/src-tauri/styles/lemo-opuscar/LICENSE). They are available offline under Style → Built in. Styles also published by Tayang appear once and use the official version when it is cached.

UI polished with unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
