import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readWorkflow = (name: string): string =>
  readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("host-update release trust", () => {
  it("threads the release key id and public SPKI into the macOS artifact build", () => {
    const releaseSet = readWorkflow("release-set.yml");
    const macosRelease = readWorkflow("macos-release.yml");

    expect(releaseSet).toContain(
      "host_update_key_id: ${{ vars.HOST_UPDATE_SIGNING_KEY_ID || 'host-update-v1' }}",
    );
    expect(macosRelease).toContain("HOST_UPDATE_P256_PUBLIC_KEY_SPKI:\n        required: true");

    const buildStep = macosRelease.match(
      /- name: Build ARM64 release app\n(?<body>[\s\S]*?)(?=\n      - name:)/,
    )?.groups?.body;
    expect(buildStep).toBeDefined();
    expect(buildStep).toContain(
      "CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI: ${{ secrets.HOST_UPDATE_P256_PUBLIC_KEY_SPKI }}",
    );
    expect(buildStep).toContain(
      "CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID: ${{ inputs.host_update_key_id || vars.HOST_UPDATE_SIGNING_KEY_ID || 'host-update-v1' }}",
    );
  });

  it("keeps the host-update private signing key out of the macOS artifact build", () => {
    const releaseSet = readWorkflow("release-set.yml");
    const macosRelease = readWorkflow("macos-release.yml");
    const buildStep = macosRelease.match(
      /- name: Build ARM64 release app\n(?<body>[\s\S]*?)(?=\n      - name:)/,
    )?.groups?.body;

    expect(buildStep).toBeDefined();
    expect(buildStep).not.toContain("HOST_UPDATE_P256_PRIVATE_KEY");
    expect(buildStep).not.toContain("CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY");
    expect(releaseSet).toContain(
      "CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY: ${{ secrets.HOST_UPDATE_P256_PRIVATE_KEY }}",
    );
  });

  it("embeds only public host-update trust in the Linux baseline bundle", () => {
    const releaseSet = readWorkflow("release-set.yml");
    const linuxRelease = readWorkflow("companion-linux-release.yml");
    const bundleBuilder = readRepoFile("scripts/build-companion-linux");
    const installerTest = readRepoFile("scripts/install-companion.test.sh");
    const buildStep = linuxRelease.match(
      /- name: Build portable bundle\n(?<body>[\s\S]*?)(?=\n      - name:)/,
    )?.groups?.body;

    expect(releaseSet).toContain(
      "host_update_key_id: ${{ vars.HOST_UPDATE_SIGNING_KEY_ID || 'host-update-v1' }}",
    );
    expect(linuxRelease).toContain("HOST_UPDATE_P256_PUBLIC_KEY_SPKI:\n        required: true");
    expect(buildStep).toBeDefined();
    expect(buildStep).toContain(
      "CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI: ${{ secrets.HOST_UPDATE_P256_PUBLIC_KEY_SPKI }}",
    );
    expect(buildStep).toContain(
      "CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID: ${{ inputs.host_update_key_id || vars.HOST_UPDATE_SIGNING_KEY_ID || 'host-update-v1' }}",
    );
    expect(buildStep).not.toContain("HOST_UPDATE_P256_PRIVATE_KEY");
    expect(buildStep).not.toContain("CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY");
    expect(bundleBuilder).toContain('"$bundle_root/bootstrap/config.json"');
    expect(bundleBuilder).toContain('"$bundle_root/bootstrap/generation.json"');
    expect(bundleBuilder).toContain("CODEWIDE_COMPANION_SOURCE_REVISION");
    expect(bundleBuilder).toContain("CODEWIDE_COMPANION_BUILD");
    expect(bundleBuilder).not.toContain("HOST_UPDATE_P256_PRIVATE_KEY");
    expect(bundleBuilder).not.toContain("CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY");
    expect(installerTest).toContain('cmp "$bundled_trust" "$install_root/bootstrap/config.json"');
    expect(installerTest).toContain("expected_source_revision");
    expect(linuxRelease).toContain(
      'echo "CODEWIDE_COMPANION_SOURCE_REVISION=$GITHUB_SHA" >> "$GITHUB_ENV"',
    );
    expect(linuxRelease).toContain(
      'echo "CODEWIDE_COMPANION_BUILD=$(printf \'%.12s\' "$GITHUB_SHA")" >> "$GITHUB_ENV"',
    );
  });

  it("validates and rolls back the immutable local Linux baseline layout", () => {
    const releaseCompanion = readRepoFile("scripts/release-companion");

    expect(releaseCompanion).toContain("test -x target/release/codewide-companion-update-guardian");
    expect(releaseCompanion).toContain(
      "test -r apps/companion-linux/deploy/codewide-companion-update.service",
    );
    expect(releaseCompanion).toContain("backup_current_link");
    expect(releaseCompanion).toContain("restore_current_link");
    expect(releaseCompanion).toContain(
      'restore_target update-guardian "$BOOTSTRAP_ROOT/codewide-companion-update-guardian" 0755',
    );
    expect(releaseCompanion).toContain(
      'restore_target update-unit "$UNIT_ROOT/codewide-companion-update.service" 0644',
    );
    expect(releaseCompanion).toContain('sha256sum "$CURRENT_LINK/bin/codewide-companion"');
    expect(releaseCompanion).toContain("guardianSha256");
    expect(releaseCompanion).toContain("$GUARDIAN_SHA256");
    expect(releaseCompanion).toContain("updateUnitSha256");
    expect(releaseCompanion).toContain("$UPDATE_UNIT_SHA256");
    expect(releaseCompanion).toContain('CODEWIDE_COMPANION_BUILD="$COMPANION_BUILD"');
    expect(releaseCompanion).toContain(
      'CODEWIDE_COMPANION_SOURCE_REVISION="$SOURCE_REVISION"',
    );
    expect(releaseCompanion).not.toContain('sha256sum "$INSTALL_ROOT/codewide-companion"');
  });
});
