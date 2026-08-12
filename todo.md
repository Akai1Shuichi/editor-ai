# TODO — Build YouTube-to-HTML MCP App

Mục tiêu bản đầu: người dùng tạo project bằng link YouTube trong ChatGPT, ChatGPT phân tích link, rồi khi người dùng yêu cầu sẽ lưu một bản edit HTML vào project để preview.

## 0. Chốt giới hạn bản đầu

- [ ] Chỉ có hai màn: **Tạo project** và **Get project**.
- [ ] Chỉ có một đầu ra: `edit.html` tự chứa.
- [ ] Không làm tải video, cắt video, render MP4, timeline, scene/layer editor hay database/OAuth ở bản đầu.
- [ ] ChatGPT tự xem/phân tích URL trong conversation; server không có chức năng tải hoặc phân tích YouTube.

## 1. Khởi tạo lại project Node.js

- [ ] Giữ `type: "module"` trong `package.json`.
- [ ] Cài các package cần thiết: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`.
- [ ] Tạo thư mục `data/projects/`; thêm vào `.gitignore` nếu project chứa dữ liệu thử nghiệm riêng.
- [ ] Tạo `server.js` với HTTP server, port mặc định `8787` và endpoint MCP `/mcp` dùng Streamable HTTP.
- [ ] Tạo endpoint health `GET /` trả tên app và endpoint `/mcp`.

## 2. Làm storage project trước

- [ ] Tạo helper `createProject(title, sourceUrl)`.
- [ ] Sinh `project_id` bằng UUID.
- [ ] Mỗi project là `data/projects/<project-id>/project.json`.
- [ ] Tạo helper `getProject(projectId)`, `listProjects()` và `saveProject(project)`.
- [ ] Chỉ chấp nhận URL có hostname `youtube.com`, `www.youtube.com`, `m.youtube.com` hoặc `youtu.be`.
- [ ] Khi tạo project, lưu: `id`, `title`, `sourceUrl`, `status: "created"`, `createdAt`, `updatedAt`, `previewUrl: null`.

## 3. Làm route preview HTML

- [ ] Tạo `GET /projects/:projectId/preview`.
- [ ] Nếu chưa có `edit.html`, trả 404 hoặc trang báo “Chưa có bản edit HTML”.
- [ ] Nếu có file, trả trực tiếp với `Content-Type: text/html; charset=utf-8`.
- [ ] Không nhận path/file name từ request; luôn tự xác định file là `<project-id>/edit.html`.

## 4. Khai báo MCP tools

- [ ] `create_project(title, source_url)`: validate YouTube URL, tạo project, trả metadata.
- [ ] `get_project(project_id)`: trả metadata project và `preview_url`.
- [ ] `list_projects()`: trả danh sách project để UI chọn lại project.
- [ ] `save_edit_html(project_id, html, title?)`: chỉ cho model gọi; kiểm tra HTML không rỗng, giới hạn kích thước, lưu chính xác vào `edit.html`.
- [ ] Sau `save_edit_html`, cập nhật `status: "html_ready"`, `updatedAt` và `previewUrl`.
- [ ] Mọi tool trả `structuredContent`, để ChatGPT và widget đọc cùng một cấu trúc dữ liệu.

## 5. Viết instructions cho MCP server

- [ ] Ghi rõ: ChatGPT tự phân tích YouTube URL, không yêu cầu MCP server phân tích video.
- [ ] Ghi rõ: khi user nói “Cho tôi bản edit bằng HTML”, ChatGPT phải gọi `save_edit_html`.
- [ ] Ghi rõ: HTML phải tự chứa CSS/JS cần thiết, mở độc lập được, không chỉ trả code trong tin nhắn.
- [ ] Ghi rõ: chỉ thông báo hoàn tất sau tool call thành công.
- [ ] Ghi rõ: đầu ra là edit mockup/plan bằng HTML, không phải video MP4 render thật.

## 6. Làm widget MCP App: màn Tạo project

- [ ] Đăng ký một UI resource, ví dụ `ui://youtube-html-editor/app.html`.
- [ ] Tạo HTML widget mới trong `public/app.html`.
- [ ] Dùng MCP Apps bridge để gọi `ui/initialize` và `tools/call`.
- [ ] Tạo form gồm `title`, `source_url`, nút “Tạo project & phân tích”.
- [ ] Khi tạo thành công, lưu `project_id` trong state widget.
- [ ] Gửi `ui/message` vào conversation với URL và `project_id`, yêu cầu ChatGPT phân tích đầy đủ nội dung video.
- [ ] Hiển thị link/project ID tạo thành công.

## 7. Làm widget MCP App: màn Get project

- [ ] Gọi `list_projects` để người dùng chọn project.
- [ ] Gọi `get_project` sau khi chọn và render metadata/trạng thái.
- [ ] Nếu `status = html_ready`, hiển thị nút mở `previewUrl` trong tab mới.
- [ ] Tạo nút “Tạo bản edit bằng HTML”.
- [ ] Khi bấm, gửi `ui/message`: yêu cầu ChatGPT dựa vào phân tích trong chat tạo HTML và gọi `save_edit_html` cho đúng `project_id`.
- [ ] Sau đó poll `get_project` trong thời gian ngắn hoặc có nút “Làm mới” để thấy khi HTML đã sẵn sàng.

## 8. Nối tool mở app

- [ ] Đăng ký resource UI bằng `registerAppResource`.
- [ ] Đăng ký tool `open_app` bằng `registerAppTool` và gắn `_meta.ui.resourceUri` tới resource.
- [ ] Tool `open_app` trả project list hoặc project hiện tại để widget render ngay.
- [ ] Đánh dấu `create_project`/`save_edit_html` là write tools; `get_project`/`list_projects` là read-only.

## 9. Test local

- [ ] Chạy `npm start`.
- [ ] Dùng MCP Inspector kiểm tra discovery và gọi lần lượt bốn tools.
- [ ] Tạo project bằng URL YouTube hợp lệ; xác nhận đúng `project.json` được tạo.
- [ ] Dùng Inspector gọi `save_edit_html` với HTML mẫu; kiểm tra `edit.html` và preview route.
- [ ] Mở preview trên browser; xác nhận HTML chạy độc lập.
- [ ] Kiểm tra URL không phải YouTube, `project_id` không tồn tại và HTML rỗng đều trả lỗi rõ ràng.

## 10. Test trong ChatGPT

- [ ] Expose localhost bằng HTTPS tunnel; cấu hình URL `<https-tunnel>/mcp` trong ChatGPT Developer Mode.
- [ ] Refresh/scan tool sau mỗi thay đổi tool/resource.
- [ ] Mở cuộc chat mới, bật app và yêu cầu mở `open_app`.
- [ ] Tạo một project với link YouTube.
- [ ] Xác nhận widget gửi prompt phân tích vào cùng cuộc chat.
- [ ] Sau khi phân tích, gửi “Cho tôi bản edit bằng HTML.”
- [ ] Xác nhận ChatGPT gọi `save_edit_html`, project chuyển `html_ready`, và preview mở được.

## Tiêu chí hoàn thành MVP

- [ ] Một YouTube URL tạo được một project.
- [ ] ChatGPT nhận được context URL và phân tích trong conversation.
- [ ] Một yêu cầu “bản edit bằng HTML” làm xuất hiện `edit.html` trong đúng project.
- [ ] Get project hiển thị được trạng thái và link preview của HTML đó.
