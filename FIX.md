# MCP connect hotfix (v0.2.1)

The v0.2 connection crash was caused by `get_video_project` being registered with `registerAppTool()` without an `_meta` object.

With current `@modelcontextprotocol/ext-apps`, `registerAppTool()` reads `config._meta.ui` during registration, so `_meta` must exist even when the tool itself has no UI template.

Fixed in `server.js`:

```js
annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
_meta: {},
```

After replacing the project:

```bash
rm -rf node_modules package-lock.json
npm install
npm start
```

Then keep ngrok running:

```bash
ngrok http 8787
```

In ChatGPT, use the new HTTPS URL ending in `/mcp`, choose **No Authentication**, then refresh/recreate the development plugin connection.

Optional local validation before ChatGPT:

```bash
npx @modelcontextprotocol/inspector@latest
```

Choose **Streamable HTTP** and connect to `http://localhost:8787/mcp`.
