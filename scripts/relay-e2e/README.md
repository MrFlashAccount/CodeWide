# Isolated Relay delivery experiment

This opt-in harness boots a disposable Ubuntu VM with real systemd using KVM
inside a tools container. It does not mount host services, cgroups, SSH keys,
Companion state, or Codex profiles. Guest credentials are generated privately
inside its experiment directory. Docker exposes the Relay only on host loopback.
The cloud image is checked against Ubuntu's HTTPS SHA-256 manifest.

Build tools and the actual shared Companion/software-client fixture:

```sh
docker build -t codewide-relay-e2e-tools:local scripts/relay-e2e
python3 scripts/relay-e2e/build-client.py
```

On a Linux KVM host, start a fresh experiment and keep the VM running:

```sh
relay_experiment=$(mktemp -d /tmp/codewide-relay-public.XXXXXX)
docker run --rm --name codewide-relay-public-vm --device /dev/kvm \
  --publish 127.0.0.1::18780 \
  --mount "type=bind,src=$relay_experiment,dst=/experiment" \
  --mount "type=bind,src=$PWD/scripts/relay-e2e/vm.py,dst=/vm.py,readonly" \
  codewide-relay-e2e-tools:local python3 /vm.py --version 0.5.1 --hold
```

Use the actual published latest version, not necessarily the example `0.5.1`.
The default path downloads the public `curl | sh` installer as a fresh non-root
guest user, verifies automatic startup, SSH logout survival and a real reboot.
No installer option or version/download override is supplied to that public
installation. `--installer` permits a local candidate before publishing;
`--resume` reuses only the explicitly mounted experiment disk, not a fresh VM.

From a second terminal:

```sh
python3 scripts/relay-e2e/scenarios.py \
  --container codewide-relay-public-vm --version 0.5.1 --public
docker stop codewide-relay-public-vm
```

The scenarios invoke bare `codewide-relay pair` in a real SSH PTY, compare its
symbols with the real shared Companion's enrollment, and register a software
phone through pinned Relay TLS and end-to-end Companion TLS. They prove an
authenticated mTLS sync upgrade and refusal after device revocation. The same
running Companion then reconnects using its existing pairing after a published
0.5.0-to-latest binary upgrade and a deliberately failed startup rollback.
Operator-owned systemd settings and exact identity fingerprints must survive.
The failing binary is a clearly labelled local test artifact with a valid
checksum and version, not a published release.

Results go to `test-results/relay-e2e/`; the VM boot results also live in the
private experiment directory. Stop the named test container before removing
that directory; it contains disposable private keys and the guest disk.

This is **VM/NAT evidence**, not proof of public VPS firewall reachability,
physical Android operation, an installed macOS UI, or live Codex chat traffic.
The Companion is real, but its Codex home is empty and isolated. The fixture's
`missing-codex` mode independently exercises the real macOS-facing shared FFI
in a container without Codex; it is not native macOS application evidence.
