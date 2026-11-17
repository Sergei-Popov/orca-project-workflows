# Vendored parsers

Project Workflows uses local parser bundles to read BMad artifacts and configuration without running project scripts.

| Bundle | Upstream version | License |
| --- | --- | --- |
| `yaml/yaml.mjs` | [yaml 2.9.1](https://github.com/eemeli/yaml/tree/v2.9.1) | ISC |
| `toml/toml.mjs` | [smol-toml 1.9.1](https://www.npmjs.com/package/smol-toml/v/1.9.1) | BSD 3-Clause |

The YAML bundle is copied from `plugins/api-spec-viewer/vendor/yaml` (SHA-256 `4b296db9f60e45f89def538fe35ba60197855e65d7f184c28934f49224493aac`). Its standalone declaration adds the `Document.toJS` method used by Project Workflows.

The unminified TOML bundle exports `parse` from `smol-toml@1.9.1`. To rebuild from a scratch directory, install `smol-toml@1.9.1` and `esbuild@0.25.12`, write `export { parse } from 'smol-toml'` into `toml-entry.mjs` and run `npx esbuild toml-entry.mjs --bundle --format=esm --platform=node --outfile=toml.mjs`. Bundle SHA-256 is `ee001916e8bc1b34c8c4316bcc07d541228a44ab4948f75318378c73bac7135d`.
