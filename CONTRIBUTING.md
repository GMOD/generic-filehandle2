# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

```sh
pnpm version patch  # or minor/major
```

`pnpm version patch` runs lint, format, types, tests and build, regenerates
CHANGELOG.md with git-cliff, then pushes the tag, which triggers the publish
workflow.

[docs/api.md](docs/api.md) is written by hand, and `test/apiDocs.test.ts` fails
when a public member of `GenericFilehandle`, `LocalFile`, `RemoteFile`,
`BlobFile`, their options types, or an export, is missing from it. Document the
new member, or add it to the test's `undocumented` list with the reason it is
internal.

## Publishing

Releases publish automatically via GitHub Actions using npm trusted publishing
(OIDC, no stored token). The workflow requires `--provenance` and
`id-token: write` permissions.

Trusted publishing is already configured for this repo. To set up a new package:
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo>` (requires
npm >=11.10.0 and 2FA).

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. `scripts/release-notes.sh` extracts the notes from that version's
CHANGELOG.md section; run it with a version to preview a release's notes.
