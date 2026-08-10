# ChatGPT Video Editor v0.3.1

## Fix layout khi mở trong ChatGPT

- UI resource URI mới (`social-algorithm-v031.html`) để tránh ChatGPT dùng cache widget cũ.
- Inline mode dùng layout compact 2 cột thay vì xếp toàn bộ editor thành một cột dài.
- Editor tự yêu cầu Fullscreen sau khi MCP Apps bridge kết nối. Nếu host không cấp fullscreen, inline mode vẫn dùng được.
- Gửi `ui/notifications/size-changed` bằng `ResizeObserver` để ChatGPT cập nhật kích thước iframe.
- Bỏ `min-height: 100vh` trong iframe inline, nguyên nhân tạo chiều cao sai/blank space.

## Chạy

```bash
npm install
npm start
```

MCP: `http://localhost:8787/mcp`  
Standalone: `http://localhost:8787/editor`

Sau khi cập nhật server, vào ChatGPT Plugins và **Refresh/Scan tools**, rồi mở **chat mới** để tránh UI resource cũ.

# ChatGPT Video Editor MCP v0.3

## Fix đồng bộ AI → scene

- MCP server là source of truth cho project.
- Bản dev dùng một authoritative in-memory project để model tool calls và widget tool calls không bị tách state bởi host/session metadata khác nhau.
- Sau khi gửi prompt AI, widget poll `get_video_project` trong 30 giây và tự apply version mới.
- Click scene sẽ fetch snapshot mới từ MCP.
- Nút cũ `Đồng bộ scene` (push UI cũ lên server) đã đổi thành `Lấy bản AI mới` (pull server → UI), tránh ghi đè kết quả AI.
- Helper tools khai báo app visibility / widget accessibility cho tool calls từ widget.

> Bản v0.3 là dev single-user. Nếu deploy cho nhiều người, thêm OAuth và storage theo user/project thay cho one-process store.

# v0.2.1 hotfix

Fixes MCP connection/tool-scan crash: `TypeError: Cannot read properties of undefined (reading 'ui')`. The cause was `registerAppTool()` being called for `get_video_project` without an `_meta` object.

# ChatGPT Video Editor MCP v0.2 (không cần OpenAI API key)

Editor video dọc 9:16 cho project **Social Algorithm**. UI chạy được standalone ở `/editor`, nhưng AI/MCP chỉ hoạt động khi ChatGPT render widget từ tool `open_video_editor`.

## Quan trọng: chatgpt.com != ChatGPT App host

Mở `https://.../editor` trong một tab trình duyệt, kể cả tab đó được mở từ ChatGPT, vẫn là **standalone page**. Nó không có MCP Apps host bridge.

Đúng workflow là:

1. Chạy MCP server.
2. Expose `/mcp` bằng HTTPS/tunnel.
3. Add MCP server vào Developer mode của ChatGPT.
4. Mở **chat mới**, chọn app Video Editor trong tools/Developer mode.
5. Nhắn: `Use the Video Editor app. Call open_video_editor and render its UI.`
6. Editor phải xuất hiện **ngay trong câu trả lời của ChatGPT**. Chỉ editor đó mới có AI prompt + sync MCP.

## v0.2 sửa gì?

Bản cũ chỉ detect `window.openai`. Bản v0.2 ưu tiên chuẩn **MCP Apps bridge**:

- `ui/initialize` / `ui/notifications/initialized`
- `tools/call` để sync scene
- `ui/message` để gửi prompt vào chat
- `ui/update-model-context` để ChatGPT biết scene/layer đang chọn
- `ui/request-display-mode` cho fullscreen

Nếu host chỉ cung cấp compatibility API cũ, editor tự fallback về `window.openai`.

## 1) Chạy local

Yêu cầu Node.js 18+.

```bash
npm install
npm run start
```

- MCP endpoint: `http://localhost:8787/mcp`
- Standalone editor: `http://localhost:8787/editor`

`/editor` chỉ dùng để edit/preview/export thủ công. Đừng dùng nó để test AI host integration.

## 2) Test MCP

```bash
npm run inspect
```

MCP Inspector:

- Transport: **Streamable HTTP**
- URL: `http://localhost:8787/mcp`
- Kiểm tra tool `open_video_editor`
- Kiểm tra `get_video_project`, `update_text_layer`, `update_scene`

## 3) Expose server cho ChatGPT

Ví dụ ngrok:

```bash
ngrok http 8787
```

Nếu nhận:

```text
https://abc123.ngrok.app
```

thì MCP endpoint là:

```text
https://abc123.ngrok.app/mcp
```

## 4) Cài trong ChatGPT

Theo Developer Mode hiện tại:

1. ChatGPT → **Settings → Security and login → Developer mode** → On.
2. Vào **ChatGPT Plugins**.
3. Nhấn `+`.
4. Tạo app, connection = `https://.../mcp`.
5. Scan/review tools và create.
6. Nếu vừa sửa server/widget: vào app → **Refresh** metadata.
7. **Mở chat mới**.
8. Từ tools/Plus menu chọn **Developer mode** và bật app Video Editor cho chat đó.
9. Nhắn:

```text
Use only the Video Editor app. Call open_video_editor and render its UI.
```

Nếu đúng, editor xuất hiện inline/fullscreen trong ChatGPT.

## 5) Dấu hiệu kết nối đúng

Status trong editor sẽ hiện một trong hai:

```text
Đã kết nối MCP Apps bridge · không cần API key.
```

hoặc compatibility fallback:

```text
Đã kết nối ChatGPT compatibility bridge · không cần API key.
```

Nếu hiện:

```text
Standalone mode — /editor không phải ChatGPT App widget.
```

thì bạn đang mở trang web editor trực tiếp, chưa mở UI do `open_video_editor` render.

## 6) Dùng AI

Chọn scene → nhập prompt bên phải, ví dụ:

```text
Rút hook còn 2 dòng, nhấn mạnh số 200 và đọc được trong 2 giây.
```

Bấm **Nhờ ChatGPT sửa màn này**. UI gửi `ui/message` vào chính conversation; ChatGPT dùng MCP tools để sửa project. Không cần OpenAI API key.

## MCP tools

- `open_video_editor` — render editor.
- `get_video_project` — đọc project.
- `update_text_layer` — sửa một layer.
- `update_scene` — sửa duration/title/nhiều layer.
- `reset_video_project` — reset template.

## Troubleshooting nhanh

### “Không ở trong ChatGPT host” / “Standalone”

Không mở `/editor`. Hãy mở ChatGPT conversation có app enabled và yêu cầu tool `open_video_editor`.

### App không thấy tool mới / UI cũ

Restart server/tunnel → ChatGPT Plugins → app → **Refresh** → mở **chat mới**.

### ChatGPT không connect MCP

Endpoint phải là public HTTPS (hoặc Secure MCP Tunnel), và URL phải có `/mcp`. Test bằng MCP Inspector trước.

### Nút AI gửi được nhưng project không đổi

Hãy prompt rõ: `Use the Video Editor app update_scene/update_text_layer tool; do not just answer with suggested copy.` Write action có thể yêu cầu confirmation tùy permissions.
