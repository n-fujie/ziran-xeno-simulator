# Security

## Scope

This is a local research prototype. It has **no authentication, no user accounts and no persistence**; runs are held
in memory. It does not connect to exchanges, devices or external services, and performs no live trading or
autonomous real-world execution.

- The HTTP server binds to `127.0.0.1` by default. Setting `HOST=0.0.0.0` exposes it to the network; do not do this
  on untrusted networks. Any client that can reach it can start computationally expensive runs.
- Preset rules are TypeScript executed in-process. Only run world specifications you trust.
- The external data adapter parses CSV text and observation objects supplied by the user; treat imported data as untrusted input.
- There are no runtime dependencies; dev dependencies (`typescript`, `@types/node`) are used only for type checking.

## Reporting

Report vulnerabilities privately through GitHub private vulnerability reporting (Security Advisories):
https://github.com/n-fujie/ziran-xeno-simulator/security/advisories/new — do not open a public issue. Include the version (`package.json`), Node
version, and steps to reproduce.
