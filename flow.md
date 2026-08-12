Luồng hoạt động của widget này gồm hai quy trình chính:

1.  Luồng tạo project và phân tích video
    sequenceDiagram
    participant U as Người dùng
    participant W as Widget
    participant C as ChatGPT
    participant S as MCP Server

        W->>C: app.connect()
        C-->>W: Bridge đã kết nối

        U->>W: Nhập title và YouTube URL
        W->>S: callServerTool(create_project)
        S->>S: Tạo project.json
        S-->>W: Trả project

        W->>C: updateModelContext(current_project)
        W->>C: sendMessage("Phân tích video")
        C-->>U: Kết quả phân tích

Bước 1: Widget kết nối với ChatGPT

Khi widget được mở:

await app.connect();
state.app = app;

Sau bước này, widget mới sử dụng được:

state.app.callServerTool();
state.app.updateModelContext();
state.app.sendMessage();

Nếu mở app.html trực tiếp trên trình duyệt, bridge không tồn tại nên widget không thể gửi message vào ChatGPT.

Bước 2: Người dùng tạo project

Người dùng nhập:

title: Phân tích video AI
source_url: https://youtube.com/watch?v=abc

Widget gọi thẳng MCP Server:

const result = await state.app.callServerTool({
name: "create_project",
arguments: {
title,
source_url: sourceUrl,
},
});

MCP Server chạy hàm:

createProject(title, sourceUrl);

Sau đó tạo:

data/projects/<project-id>/project.json

Và trả về:

{
structuredContent: {
project: {
id: "abc-123",
title: "Phân tích video AI",
sourceUrl: "https://youtube.com/watch?v=abc",
status: "created",
previewUrl: null,
},
},
}
Bước 3: Cập nhật project hiện tại

Widget lấy project vừa tạo:

const project = result.structuredContent.project;

Sau đó cập nhật context:

await state.app.updateModelContext({
structuredContent: {
current_project: project,
},
});

Bây giờ ChatGPT biết:

Project hiện tại là abc-123.

Nhưng ChatGPT chưa bắt đầu phân tích vì updateModelContext() chỉ cập nhật thông tin, không giao nhiệm vụ.

Bước 4: Gửi yêu cầu phân tích

Widget gọi:

await state.app.sendMessage({
role: "user",
content: [
{
type: "text",
text: `Hãy phân tích video ${project.sourceUrl}`,
},
],
});

Message xuất hiện trong conversation. ChatGPT nhận URL và bắt đầu phân tích.

Ở bước này MCP Server không phân tích video. ChatGPT tự xử lý URL bằng khả năng hiện có.

2. Luồng tạo bản edit HTML

Sau khi ChatGPT đã phân tích xong, người dùng chọn project và bấm:

Tạo bản edit bằng HTML
sequenceDiagram
participant U as Người dùng
participant W as Widget
participant C as ChatGPT
participant S as MCP Server

    U->>W: Chọn project
    W->>S: callServerTool(get_project)
    S-->>W: Trả metadata project

    W->>C: updateModelContext(current_project)
    W->>C: sendMessage("Tạo bản edit HTML")
    C->>C: Tạo nội dung HTML
    C->>S: Gọi save_edit_html
    S->>S: Lưu edit.html
    S-->>C: Lưu thành công
    C-->>U: Thông báo hoàn tất

    W->>S: callServerTool(get_project)
    S-->>W: status = html_ready

Bước 1: Widget lấy project
const result = await state.app.callServerTool({
name: "get_project",
arguments: {
project_id: selectedProjectId,
},
});

Server trả metadata hiện tại:

{
id: "abc-123",
status: "created",
previewUrl: null,
}
Bước 2: Widget cập nhật context
await state.app.updateModelContext({
structuredContent: {
current_project: project,
},
});

ChatGPT biết chính xác project nào cần được tạo HTML.

Bước 3: Widget giao việc cho ChatGPT
await state.app.sendMessage({
role: "user",
content: [
{
type: "text",
text: `
Dựa vào phần phân tích trước đó,
hãy tạo HTML cho project abc-123
và gọi save_edit_html.
`,
},
],
});

sendMessage() không trực tiếp gọi save_edit_html. Nó yêu cầu ChatGPT thực hiện công việc.

Bước 4: ChatGPT tạo HTML

ChatGPT dựa trên phần phân tích trước đó để tạo:

<!doctype html>
<html lang="vi">
  <head>
    <style>
      /* CSS */
    </style>
  </head>

  <body>
    <!-- Nội dung bản edit -->

    <script>
      // Hiệu ứng và điều khiển
    </script>

  </body>
</html>
Bước 5: ChatGPT gọi save_edit_html

Sau khi tạo xong nội dung, ChatGPT gọi MCP tool:

{
"project_id": "abc-123",
"title": "Bản edit video AI",
"html": "<!doctype html><html>...</html>"
}

MCP Server lưu file:

data/projects/abc-123/edit.html

Đồng thời cập nhật project.json:

{
"id": "abc-123",
"status": "html_ready",
"previewUrl": "/projects/abc-123/preview"
}
Bước 6: Widget làm mới trạng thái

Widget poll hoặc người dùng bấm “Làm mới”:

await state.app.callServerTool({
name: "get_project",
arguments: {
project_id: "abc-123",
},
});

Kết quả mới:

{
status: "html_ready",
previewUrl: "/projects/abc-123/preview",
}

Widget lúc này hiển thị nút:

Mở bản preview
Tóm tắt vai trò
callServerTool()
→ Widget gọi thẳng MCP Server
→ Dùng để tạo, đọc và liệt kê project

updateModelContext()
→ Widget cho ChatGPT biết project đang chọn
→ Không tạo phản hồi, không lưu dữ liệu

sendMessage()
→ Widget gửi yêu cầu vào conversation
→ ChatGPT bắt đầu phân tích hoặc tạo HTML

Luồng hoàn chỉnh:

Mở widget
→ connect()
→ create_project
→ updateModelContext()
→ sendMessage("Phân tích video")
→ ChatGPT phân tích
→ sendMessage("Tạo HTML")
→ ChatGPT gọi save_edit_html
→ Server lưu edit.html
→ get_project
→ Mở preview
