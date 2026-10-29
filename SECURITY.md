# Security policy

## Reporting a vulnerability

If you find a security vulnerability in Full Page Shot, **do not open a public issue**. Instead:

1. Go to the repository's **Security** tab on GitHub.
2. Click **Report a vulnerability** (GitHub Private Vulnerability Reporting).
3. Describe the problem, the steps to reproduce it and its impact.

I'll respond as soon as possible and coordinate the fix release.

## Scope

- The `debugger` permission is inherent to the functionality: the extension needs access to the DevTools Protocol to capture the full page. That is not a vulnerability.
- The extension does not send data to external servers: all capture and saving happens locally.
- The extension does not request `host_permissions`: the URL and title are read via CDP.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x (current) | ✅ |
| < 1.0 | ❌ |
