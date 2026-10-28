# Entity Explorer

A Home Assistant sidebar panel that browses entities, devices and areas as trees.

This is an early scaffold. The panel only shows entity, device and area counts so far.

## Install

Entity Explorer ships as a HACS custom integration. Add
`https://github.com/hay-kot/ha-entity-explorer` to HACS as a custom repository with the
Integration type, then install a release. Each GitHub release carries an `entity_explorer.zip`
with the built panel bundle. After you install it, add it from
**Settings > Devices & services > Add integration**. The panel shows up in the sidebar for
admin users.

## Development

Tools are pinned in `mise.toml`: Node, pnpm, Python, uv and ruff.

```sh
mise install
mise run setup    # uv sync + pnpm install
mise run develop  # builds the panel, then starts Home Assistant on http://localhost:8123
```

`develop` uses `config/` as the Home Assistant config directory and loads the integration
from `custom_components/` at the repo root.

| Task | What it does |
| --- | --- |
| `setup` | Installs Python (uv) and frontend (pnpm) dependencies |
| `build` | Builds `frontend/` into `custom_components/entity_explorer/frontend/entity-explorer.js` |
| `watch` | Rebuilds the bundle on change. Reload the browser to pick it up. |
| `develop` | Builds, then runs Home Assistant |
| `lint` | ruff check, ruff format check and the TypeScript typecheck |
| `fmt` | ruff format and autofix |
| `check` | `lint` and `build` |

The built bundle is gitignored.

## Layout

| Path | Purpose |
| --- | --- |
| `custom_components/entity_explorer/` | Integration: config flow, static path for the bundle, panel registration |
| `frontend/` | Lit + TypeScript panel, built with Vite |
| `config/configuration.yaml` | Home Assistant config for `mise run develop` |
