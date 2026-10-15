# Getting started

This page walks through the first setup step by step, including every branch
of the macOS setup assistant. The short version is in the
[README](../README.md#get-started); install options, relays, tunnels and
pairing details are in [self-hosting](self-hosting.md).

## On a Mac

You need a Mac with Apple Silicon and macOS 26+, and an Android phone. A relay
is optional: without one, the phone connects over the same network or a VPN.

**1. Install and open CodeWide.** If you don't have Homebrew yet, install it
from [brew.sh](https://brew.sh/) and run the *Next steps* it prints. Then:

```sh
brew update
brew tap MrFlashAccount/codewide
brew trust --cask MrFlashAccount/codewide/codewide
brew install --cask MrFlashAccount/codewide/codewide
```

CodeWide is self-signed for now. Homebrew
[removed `--no-quarantine`](https://github.com/Homebrew/brew/pull/23363), so
clear the quarantine flag on CodeWide only and launch it:

```sh
xattr -dr com.apple.quarantine /Applications/CodeWide.app
open -a CodeWide
```

The setup assistant opens by itself on first launch.

**2. Setup → Codex.** Follow the assistant:

- If it offers **Open Login Items**, allow CodeWide to run in the background.
- If the Codex CLI isn't installed yet, install it and sign in
  ([OpenAI's instructions](https://developers.openai.com/codex/cli)):

  ```sh
  brew install --cask codex
  codex
  ```

  Choose **Sign in with ChatGPT**, then return to the assistant and click
  **Scan Again**.
- Pick a Codex profile if the assistant asks.
- If you see **Start Codex**, click it.

**3. Setup → Relay (optional).**

- *Same network or VPN:* click **Use Direct** and go to step 4. No server
  needed.
- *Over the internet:* you need a Linux x86_64 server with systemd, for
  example Ubuntu 24.04. Click **Set Up Relay…** and run on the server:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay | sh
  ```

  The relay installs as a systemd user service without `sudo` and starts
  right away and with every login of that user. For a relay that must run
  before login and after logout, enable systemd lingering for the user, see
  [self-hosting](self-hosting.md#reach-the-companion-from-your-phone). Allow
  inbound TCP `8780` in the server firewall and your provider's network rules,
  then run:

  ```sh
  codewide-relay pair
  ```

  Keep that terminal open. On the Mac, enter the `IP:port` it shows and
  click **Connect**. Check that the Mac and the server show the same four
  symbols, and press Enter in the server terminal. When you see
  **Relay connected**, click **Done**, then **Continue**. If the one-minute
  window runs out, run `codewide-relay pair` again.

**4. Setup → Your phone.** The Mac shows a QR code. On Android:

1. Download `CodeWide-*.apk` from the
   [latest release](https://github.com/MrFlashAccount/CodeWide/releases/latest).
2. Open it and allow installs from this source if Android asks.
3. Launch CodeWide and tap **Add server**.
4. Scan the QR code on the Mac.

You don't type the Mac's or the relay's address on the phone. If the code
expires, click **New Code** on the Mac. Don't share it: it contains a
connection secret. When the phone shows up in the assistant, click
**Finish Setup**.

**5. Check the connection.** Open your Mac in the app and send Codex a
message.

- Without a relay, the phone has to stay on the same network or VPN.
- With a relay, turn off Wi-Fi on the phone and try over mobile data.

The Mac has to stay on and awake. **Keep Awake** in the menu bar prevents idle
sleep while it is plugged in.

## On a Linux server

For a headless x86_64 machine with systemd, over SSH:

```sh
# 1. Start Codex's App Server (Codex CLI must be installed and signed in)
codex app-server daemon start

# 2. Install the Companion as a user service
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/companion | sh

# 3. Connect it to your relay: run `codewide-relay invite` on the relay
#    host, then paste the invite here
codewide-companion relay pair <relay-ip>:8780

# 4. Show a pairing QR code
codewide-companion pair
```

On the phone, tap **Add server** and scan the code. It works once and expires
in five minutes. Prefer your own TLS ingress over a relay? See
[self-hosting](self-hosting.md#reach-the-companion-from-your-phone).

### Relay for a Linux Companion

Install the relay on a server with a public IP as in the Mac step 3 above,
allow TCP `8780`, then run `codewide-relay invite` there and paste its output
into `codewide-companion relay pair <relay-ip>:8780` on your Linux machine.

## Add Claude Code

Install `claude` on the same machine and sign in. The Companion picks it up;
nothing else to configure. Which features are available on Claude threads
and which are Codex-only is listed in [agent providers](agent-providers.md).

## Next

- Open a port: start your dev server on the machine and look for its chip in
  the composer. Details in
  [phone-local port forwarding](self-hosting.md#phone-local-port-forwarding).
- Open a terminal from the thread menu. Details in
  [interactive terminal](self-hosting.md#interactive-terminal).
- Pair a second machine the same way; it appears in the server rail.
- Lost a phone? Revoke it: see
  [pairing and device security](self-hosting.md#pairing-and-device-security).
