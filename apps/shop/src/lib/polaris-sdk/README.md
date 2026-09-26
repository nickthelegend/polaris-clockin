# Stand-in for `polarispay-sdk@0.3.0`

This folder is a temporary, spec-exact stand-in for the parts of
`polarispay-sdk@0.3.0` the shop uses, written while the real package is built
on the `metropolis/sdk` branch. Nothing in the shop imports it directly:

- `src/lib/polaris.ts` (server) imports `./polaris-sdk/server`
- `src/lib/polaris-client.ts` (browser) imports `./polaris-sdk/browser` and
  `./polaris-sdk/react`

When 0.3.0 lands, point those two files at `polarispay-sdk` and
`polarispay-sdk/react`, add the dependency, and delete this folder. Anything
here that goes beyond the spec is listed in the shop README under
"What the shop needs from the SDK".
