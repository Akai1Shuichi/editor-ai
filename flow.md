# Flow: YouTube → ChatGPT phân tích → bản edit HTML

## Mục tiêu

Project chỉ làm một việc: lưu link YouTube vào một project, để ChatGPT phân tích video trong cuộc chat, sau đó nhận **một file HTML tự chứa** do ChatGPT tạo và gắn file đó vào project để preview/mở lại.

Không làm timeline editor, scene editor, layer editor hay xuất video ở giai đoạn này.

Ví dụ yêu cầu trong ChatGPT:

```text
https://www.youtube.com/watch?v=7zCsfe57tpU&t=42s

Phân tích đầy đủ nội dung, và edit video link trên.
```

Sau khi ChatGPT phân tích xong, người dùng gửi:

```text
Cho tôi bản edit bằng HTML.
```

## Kiến trúc tối giản

```text
ChatGPT conversation
  │
  ├─ MCP tool: create_project(source_url)
  │       └─ lưu metadata project vào data/projects/<project-id>/project.json
  │
  ├─ ChatGPT tự phân tích URL YouTube trong chat
  │       └─ MCP server không tải, không scrape, không phân tích video
  │
  └─ MCP tool: save_edit_html(project_id, html)
          └─ lưu data/projects/<project-id>/edit.html
                    │
                    ├─ MCP tool: get_project(project_id) trả metadata + preview URL
                    └─ GET /projects/<project-id>/preview render edit.html
```

MCP server là nơi lưu dữ liệu. ChatGPT là nơi suy luận/phân tích và viết mã HTML.

## Hai màn UI cần có

### 1. Màn tạo project

Form chỉ cần:

- `Tên project` (có thể tự điền từ prompt hoặc link).
- `Link YouTube` — bắt buộc, validate là URL YouTube hợp lệ.
- Nút **Tạo project và nhờ ChatGPT phân tích**.

Khi bấm nút:

1. Widget gọi `create_project` qua MCP với `title` và `source_url`.
2. Server tạo thư mục project và trả `project_id`.
3. Widget gửi `ui/message` vào cùng conversation với prompt có `project_id`, `source_url` và yêu cầu ChatGPT phân tích đầy đủ video.
4. ChatGPT trả phần phân tích trong chat. Không cần lưu analysis vào project ở bản đầu tiên.

### 2. Màn Get project

Màn này hiển thị:

- Tên, `project_id`, link YouTube, thời gian tạo/cập nhật.
- Trạng thái: `created` hoặc `html_ready`.
- Nếu đã có HTML: nút **Xem bản edit HTML** mở `preview_url`.
- Nút **Tạo bản edit bằng HTML**. Nút này gửi `ui/message` kèm `project_id`, yêu cầu ChatGPT tạo HTML và bắt buộc gọi `save_edit_html`.

Không hiển thị hoặc chỉnh sửa mã HTML trong widget ở bản đầu; preview ở trang riêng để hạn chế UI và CSP phức tạp.

## MCP tools tối thiểu

| Tool | Ai gọi | Mục đích |
| --- | --- | --- |
| `create_project` | Widget hoặc ChatGPT | Tạo project từ tên và YouTube URL. |
| `get_project` | Widget hoặc ChatGPT | Đọc metadata, trạng thái và `preview_url`. |
| `list_projects` | Widget | Liệt kê để chọn project cũ. |
| `save_edit_html` | Chỉ ChatGPT | Nhận chuỗi HTML hoàn chỉnh, validate, lưu `edit.html`, đổi trạng thái thành `html_ready`. |

`save_edit_html` là điểm nối quan trọng: ChatGPT **không upload file thật** vào source code. ChatGPT viết toàn bộ nội dung HTML vào tham số `html` của tool; server biến chuỗi đó thành file `edit.html` thuộc project.

Schema ý tưởng:

```ts
save_edit_html({
  project_id: string,
  html: string,          // tài liệu HTML hoàn chỉnh, bắt đầu bằng <!doctype html>
  title?: string
})
```

Tool này chỉ nhận HTML hoàn chỉnh. Không cho phép tên file hoặc đường dẫn từ ChatGPT để tránh ghi file ra ngoài thư mục project.

## Luồng thao tác hoàn chỉnh

```text
1. User mở MCP App trong ChatGPT
2. User nhập YouTube URL ở màn tạo project
3. Widget → create_project
4. Server lưu project.json, trả project_id
5. Widget → ui/message:
   “Phân tích đầy đủ video <URL>. Đây là project_id <ID>.”
6. ChatGPT phân tích video và trả kết quả vào conversation
7. User nói: “Cho tôi bản edit bằng HTML.”
8. ChatGPT tạo HTML tự chứa rồi gọi save_edit_html(project_id, html)
9. Server lưu edit.html và trả preview_url
10. User mở Get project → Xem bản edit HTML → /projects/<ID>/preview
```

## Quy ước prompt cho ChatGPT

MCP server phải có `instructions` ngắn và rõ:

```text
Khi user cung cấp YouTube URL, hãy tự phân tích nội dung video trong ChatGPT.
Khi user yêu cầu “bản edit bằng HTML”, gọi get_project để lấy project_id nếu cần.
Tạo một HTML độc lập, responsive, có thể mở trực tiếp bằng trình duyệt.
Sau đó bắt buộc gọi save_edit_html với toàn bộ mã HTML.
Chỉ trả lời rằng bản edit đã sẵn sàng sau khi tool lưu thành công.
```

HTML sinh ra nên là một mockup/edit plan trực quan (khung video 9:16, caption, timeline/shot list, hiệu ứng và CTA), không được tuyên bố là file video đã render.

## Dữ liệu một project

```text
data/
  projects/
    <project-id>/
      project.json     # metadata
      edit.html        # chỉ xuất hiện sau save_edit_html
```

`project.json` tối thiểu:

```json
{
  "id": "uuid",
  "title": "Video edit",
  "sourceUrl": "https://www.youtube.com/watch?v=...",
  "status": "created",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "previewUrl": null
}
```

Sau khi lưu HTML, đổi `status` thành `html_ready` và đặt `previewUrl` là `/projects/<project-id>/preview`.

## Ranh giới trách nhiệm

- Widget: tạo project, đọc project, gửi prompt và mở preview.
- MCP server: validate input, lưu/đọc file project, cung cấp tools và route preview.
- ChatGPT: phân tích video YouTube và tạo nội dung `edit.html`.
- `edit.html`: sản phẩm đầu ra để người dùng xem; không phải widget của MCP App.
