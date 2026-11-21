# Contributing to Grain

Thanks for helping. Bug reports, model compatibility reports and pull requests are all welcome.

## Reporting a bug

Open an issue with your macOS version, Mac model, Grain version and the steps to reproduce. Never attach recordings or transcripts of real meetings.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Set up the build (see [Build from source](README.md#build-from-source)).
3. Make your change. For any UI work, follow the design system in [design/](design/) and the rules in [CLAUDE.md](CLAUDE.md).
4. Run the checks before you open the PR:

   ```bash
   npm run typecheck && npm run lint && npm test
   (cd src-tauri && cargo test --lib && cargo clippy)
   ```

5. Open a pull request that says what changed and how you tested it.

## Ground rules

- Grain stays local. No telemetry, no accounts, no network calls at runtime other than model downloads the user starts. See [docs/PRIVACY.md](docs/PRIVACY.md).
- Keep pull requests small and focused on one thing.

## Releasing (maintainers)

Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, commit, then push a tag:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

The Release workflow builds `Grain.pkg` (installs into Applications) and `Grain.dmg` and publishes both on the GitHub Releases page.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
