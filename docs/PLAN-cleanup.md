# Dọn dẹp hàng loạt: nghiên cứu và kế hoạch

> Trạng thái v1.3.0 (26/11/2026): đã triển khai bỏ lưu, gỡ like và cảm xúc, xoá bình luận.
> Còn kiểm tra hộp xác nhận và kết quả gỡ trên Nhật ký hoạt động thật. Bỏ theo dõi đang trong kế hoạch.

## 1. Khảo sát trên Facebook thật (chỉ đọc, không thực hiện hành động nào)

| Tính năng | Trang | Facebook có sẵn chọn nhiều? | Thao tác từng mục |
| --- | --- | --- | --- |
| Bỏ lưu | `facebook.com/saved/` | **Không** | Nút `aria-label="Hành động khác, <tiêu đề>"` → menu chỉ có **1 mục "Bỏ lưu"** |
| Gỡ like/cảm xúc | Nhật ký hoạt động → Bình luận và cảm xúc → **Lượt thích và cảm xúc** | **Có**: checkbox mỗi dòng (`aria-label="Chọn bài viết từ <giờ> <ngày>"`), ô "Tất cả", nút **"Gỡ"** | Nút `"Lựa chọn khác cho <tên>"` → menu |
| Xoá bình luận | Nhật ký hoạt động → **Bình luận** | **Có**: checkbox, "Tất cả", **"Gỡ"** | Nút `"Lựa chọn khác cho <tên>"` → menu chỉ có **"Xóa"** |
| Bỏ theo dõi | `facebook.com/me/following` (tab "Đang theo dõi") | **Không** | Nút `"Lựa chọn khác cho <tên>"` → menu: **"Bỏ theo dõi"**, "Báo cáo trang cá nhân", **"Chặn"** |

Ghi chú:

- URL Nhật ký hoạt động dùng `.../allactivity/?category_key=...`. Danh sách tải dần khi cuộn, khoảng
  25 dòng mỗi lần.
- Tài khoản hiện theo dõi khoảng 706 mục, gồm cả người và trang.
- **Menu bỏ theo dõi có "Chặn" ngay cạnh.** Chỉ được chọn mục theo nhãn chính xác, tuyệt đối không
  chọn theo vị trí. Đây là cùng nguyên tắc đang dùng trong `frame/delete.ts`.
- Mục "Bộ sưu tập và mục đã lưu" trong Nhật ký hoạt động **không** có checkbox, nên bỏ lưu phải
  làm từ trang `/saved/`.

## 2. Rủi ro cần chấp nhận trước khi làm

1. **Tài khoản bị hạn chế.** Facebook phát hiện thao tác lặp nhanh và có thể "tạm thời chặn tính
   năng" hoặc bắt checkpoint. Điều khoản của Facebook cấm truy cập và hành động tự động. Do đó phải
   chạy chậm như người thật, có giới hạn mỗi ngày, và dừng ngay khi thấy cảnh báo.
2. **Không hoàn tác được.**
   - Bình luận bị xoá là mất hẳn.
   - Like hay bài đã lưu chỉ khôi phục được bằng cách tự tìm lại bài.
   - Bỏ theo dõi phải tự theo dõi lại từng người.
3. **Duyệt trên Chrome Web Store.** Quyết định: **gộp vào cùng một extension**, định vị chung là
   "FB Sidekick: công cụ hỗ trợ thao tác Facebook". Danh bạ và dọn dẹp cùng phục vụ mục đích đó,
   nên không vi phạm quy định "single purpose". Điểm cần giải thích kỹ khi nộp là việc tự động thực
   hiện thao tác không hoàn tác được, và việc gỡ header `X-Frame-Options`. Code dọn dẹp nằm riêng
   trong `src/cleanup/` và có công tắc bật/tắt trong popup.

## 3. Cách dùng và hành vi trong v1.3.0

### Giao diện

- Trang **Đã lưu** có ô chọn tròn trên từng thẻ. Nhấn Shift khi bấm để chọn một dải.
  Tab đưa tiêu điểm đến ô chọn, rồi nhấn Space hoặc Enter để đổi trạng thái.
- Hai mục **Gỡ like và cảm xúc** và **Xoá bình luận** trong FB Sidekick mở thẳng danh mục tương ứng.
  Lần đầu, công cụ tìm liên kết trong thanh điều hướng của Nhật ký hoạt động. Các lần sau có thể
  dùng lại đường dẫn đã lưu. Trên trang tổng quan và **Bình luận và cảm xúc**, bảng có hai nút để mở
  danh mục. Nếu không tìm được mục, bảng hướng dẫn mở bằng tay.
- Nhật ký hoạt động dùng ô chọn của Facebook. **Chọn tất cả đã tải**, **Bỏ chọn** và **Tải hết**
  nằm trong bảng FB Sidekick. Khi bắt đầu một lô, Facebook chỉ giữ dấu chọn của các dòng trong lô đó.
- Hộp xác nhận của FB Sidekick ghi số mục, thao tác và hậu quả. Nút **Huỷ** nhận tiêu điểm ban đầu.

### Bộ chạy dùng chung

- Bỏ lưu lần lượt, cách 3–7 giây và nghỉ 2–3 phút sau mỗi 25 mục.
- Với Nhật ký hoạt động, mỗi lô tối đa 25 dòng. Công cụ đối chiếu các ô đang chọn với lô hiện tại,
  bấm **Gỡ**, tìm nút xác nhận theo nhãn tiếng Việt hoặc tiếng Anh, rồi kiểm tra từng dòng đã rời
  danh sách. Các lô cách nhau 2–3 phút.
- Bỏ lưu, gỡ cảm xúc và xoá bình luận dùng chung giới hạn 200 dòng đã xác nhận mỗi ngày trên các tab.
  Bộ đếm lưu trong `chrome.storage.local`. Hàng đợi tồn tại trong tab đang chạy.
- Công cụ dừng khi nút hoặc tập ô đã chọn không xác định được, khi kết quả không xác minh được,
  khi Facebook báo giới hạn hoặc bảo mật, hoặc khi người dùng bấm **Dừng**.

### Mã nguồn và kiểm tra

- `src/hub/main.ts` nhận diện trang và mục đang mở. `src/cleanup/dom.ts` theo dõi cột chính và
  gộp các thay đổi vào một lượt đồng bộ mỗi khung hình.
- `src/cleanup/saved.ts` xử lý mục đã lưu. `src/cleanup/activity.ts` nhận diện dòng, ô chọn,
  nút gỡ và hộp xác nhận. `src/cleanup/runner.ts` xử lý hàng đợi, thời gian nghỉ và giới hạn ngày.
  `src/cleanup/toolbar.ts` và `selection.css` hiển thị ô chọn và tiến độ.
- `tests/cleanup.test.ts` kiểm tra nhãn, nhận diện mục, cách chia lô, giới hạn ngày và điều kiện dừng.
- Cần xác nhận trên giao diện thật của cả hai mục: nhãn và phạm vi ô chọn, nhãn hộp thoại sau
  **Gỡ**, việc các dòng rời danh sách và trạng thái khi xoá hết. Bản dev ghi nhãn nút và tiêu đề
  hộp xác nhận trong phạm vi từ vựng giao diện, che nhãn ngoài phạm vi này.
