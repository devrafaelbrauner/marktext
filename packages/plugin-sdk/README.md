# @marktext-plus/plugin-sdk

Client bridge for MarkText Plus community plugins. A plugin calls `definePlugin`
from its `main` module; the host runs that module in a sandboxed iframe and
talks to it over a MessagePort.

The full contract — manifest, permissions, RPC methods and limits — is in
[docs/plus/sdk/README.md](../../docs/plus/sdk/README.md) (pt-BR) and
[docs/plus/sdk/README.en.md](../../docs/plus/sdk/README.en.md).

```ts
import { definePlugin } from '@marktext-plus/plugin-sdk'

definePlugin({
  async activate(api) {
    await api.notify({ message: 'Hello' })
  }
})
```

Build the package with `pnpm --filter @marktext-plus/plugin-sdk build`. The
starter in `templates/community-plugin` emits a zip with `pnpm build`.
