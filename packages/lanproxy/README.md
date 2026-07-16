# @nuwax-ai/lanproxy

Platform-aware resolver for the `nuwax-lanproxy` executable.

```bash
npm install @nuwax-ai/lanproxy
```

```js
import { resolveBinaryPath } from "@nuwax-ai/lanproxy";

const binaryPath = resolveBinaryPath();
```

npm installs only the optional package matching the current OS and CPU:

- `@nuwax-ai/lanproxy-darwin-arm64`
- `@nuwax-ai/lanproxy-darwin-x64`
- `@nuwax-ai/lanproxy-linux-arm64`
- `@nuwax-ai/lanproxy-linux-x64`
- `@nuwax-ai/lanproxy-win32-x64`

Do not install with `--omit=optional`; that intentionally omits the executable.
