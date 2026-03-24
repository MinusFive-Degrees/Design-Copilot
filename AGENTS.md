# Repository Guidelines

## Project Structure & Module Organization

This repository packages a 嘉立创 EDA extension named `Design Copilot`. Core extension logic lives in `src/index.ts`. Build tooling is under `config/` and `build/`; `config/esbuild*.ts` compiles the extension, while `build/packaged.ts` emits `.eext` packages into `build/dist/`. Static assets live in `images/`, bundled iframe pages in `iframe/`, and locale resources in `locales/`.

## Build, Test, and Development Commands

Use `npm install` to install dependencies. Use `npm run build` to compile `src/` into `dist/` and package the installable extension into `build/dist/`. Use `npm run fix` to run Prettier and ESLint fixes before submitting changes. For release-style iterations, run `./scripts/release-iteration.ps1 -Version 0.1.0 -CommitMessage "feat: ..." -Changes @("item 1", "item 2")`.

## Coding Style & Naming Conventions

Write TypeScript in strict mode and keep changes compatible with the global `eda` API surface from `@jlceda/pro-api-types`. Existing source files use tabs for indentation; preserve that style. Prefer small helper functions, explicit names such as `buildPcbReport` or `highlightMostConnectedNet`, and menu-facing exports in `src/index.ts`. Run `npm run fix` after non-trivial edits.

## Testing Guidelines

There is no standalone test suite in this repository. Validation is build-based: `npm run build` must succeed, and the generated `.eext` in `build/dist/` should match the current extension version. When touching report logic or menu wiring, verify `extension.json`, `CHANGELOG.md`, and the packaged artifact stay in sync.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style, for example `feat: add pcb dense net analysis (v0.0.3)` or `docs: refresh readme for Design Copilot (v1.0.5)`. Every functional change should update `CHANGELOG.md`, bump versions consistently, and keep the corresponding `.eext` artifact. Pull requests should describe user-visible behavior changes, list affected menus or reports, and mention the packaged version produced in `build/dist/`.

