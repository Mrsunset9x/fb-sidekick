# Dọn dẹp hàng loạt: nghiên cứu và kế hoạch

> Trạng thái (26/11/2026): **mới nghiên cứu, chưa code.** Ba tính năng: bỏ lưu bài viết hàng loạt,
> gỡ like/cảm xúc và xoá bình luận hàng loạt, bỏ theo dõi hàng loạt.

## 1. Khảo sát trên Facebook thật (chỉ đọc, không thực hiện hành động nào)

| Tính năng | Trang | Facebook có sẵn chọn nhiều? | Thao tác từng mục |
| --- | --- | --- | --- |
| Bỏ lưu | `facebook.com/saved/` | **Không** | Nút `aria-label="Hành động khác, <tiêu đề>"` → menu chỉ có **1 mục "Bỏ lưu"** |
| Gỡ like/cảm xúc | Nhật ký hoạt động → Bình luận và cảm xúc → **Lượt thích và cảm xúc** | **Có**: checkbox mỗi dòng (`aria-label="Chọn bài viết từ <giờ> <ngày>"`), ô "Tất cả", nút **"Gỡ"** | Nút `"Lựa chọn khác cho <tên>"` → menu |
| Xoá bình luận | Nhật ký hoạt động → **Bình luận** | **Có**: checkbox, "Tất cả", **"Gỡ"** | Nút `"Lựa chọn khác cho <tên>"` → menu chỉ có **"Xóa"** |
| Bỏ theo dõi | `facebook.com/me/following` (tab "Đang theo dõi") | **Không** | Nút `"Lựa chọn khác cho <tên>"` → menu: **"Bỏ theo dõi"**, "Báo cáo trang cá nhân", **"Chặn"** |

Ghi chú:

- URL Nhật ký hoạt động dùng `.../allactivity?category_key=...`. Danh sách tải dần khi cuộn, khoảng
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

## 3. Thiết kế đề xuất

### Giao diện

- Một thanh công cụ nổi (shadow DOM, dùng biến CSS của Facebook) **chỉ xuất hiện trên đúng 4 trang**
  ở trên.
- Thanh có: số mục đã tải, **Chọn tất cả đang hiển thị**, **Tải thêm** (tự cuộn đến N mục hoặc đến
  hết), **Bắt đầu**, **Tạm dừng / Dừng**, thanh tiến độ và nhật ký từng mục.
- Bỏ lưu và bỏ theo dõi: mỗi dòng có checkbox do extension thêm vào, để người dùng chọn hoặc bỏ chọn
  từng mục trước khi chạy. Có lọc theo tên, ví dụ chỉ chọn các trang "Cho thuê…".
- **Hộp xác nhận bắt buộc**: nêu rõ số mục, loại thao tác, cho biết không hoàn tác được. Nút nguy
  hiểm có màu đỏ và không được focus sẵn.

### Bộ chạy (dùng chung cho cả 3 tính năng)

- Hàng đợi, mỗi lần làm một mục:
  1. mở menu của dòng;
  2. tìm mục theo **nhãn chính xác** (bảng nhãn tiếng Anh và tiếng Việt);
  3. bấm;
  4. nếu có hộp xác nhận thì bấm nút xác nhận đã nhận diện được;
  5. **kiểm tra lại** rằng dòng đã biến mất hoặc đã đổi trạng thái.
- Nhịp chạy: nghỉ ngẫu nhiên 3–7 giây giữa các mục, nghỉ 2–3 phút sau mỗi 25 mục, và giới hạn mỗi
  ngày (mặc định 200 mục, chỉnh được).
- **Dừng ngay, không thử lại** khi:
  - không nhận diện được nút;
  - menu chứa mục lạ;
  - xuất hiện hộp thoại có chữ "tạm thời bị chặn", "temporarily blocked", "checkpoint", "thử lại sau"…;
  - tab bị ẩn quá lâu;
  - người dùng bấm Dừng.
- Like và bình luận: ưu tiên **dùng chế độ chọn nhiều có sẵn của Facebook** (tick checkbox theo lô
  25 mục → bấm "Gỡ" → xác nhận). Cách này gửi ít request hơn và đi đúng luồng chính thức.
- Lưu tiến độ vào `chrome.storage.local` để sau khi tải lại trang có thể chạy tiếp. Nhật ký chỉ
  ghi số lượng, không ghi nội dung.

### Code

- Thư mục `src/cleanup/`:
  - `main.ts`: nhận diện trang và gắn thanh công cụ;
  - `runner.ts`: hàng đợi, nhịp chạy, điều kiện dừng (hàm thuần, test được);
  - `finders.ts`: dòng, nút menu, bảng nhãn;
  - `saved.ts`, `activity.ts`, `following.ts`;
  - `toolbar.ts`/`.css`.
- Thêm một content script `cleanup.js` vào manifest hiện có.
- Không cần quyền mới: chỉ `storage` và host `facebook.com`.
- Test: runner (nhịp, giới hạn ngày, dừng khi gặp cảnh báo), finders với DOM mẫu như
  `tests/delete.test.ts` (không bấm "Chặn" dù nằm cạnh, nhãn lạ thì dừng).

### Thứ tự làm đề xuất

1. Bộ chạy chung, thanh công cụ và **Bỏ lưu** (an toàn nhất: menu chỉ có 1 mục).
2. **Gỡ like / xoá bình luận** qua chế độ chọn nhiều của Nhật ký hoạt động.
3. **Bỏ theo dõi** (rủi ro bấm nhầm "Chặn" cao nhất, nên làm sau cùng và test kỹ nhất).

Mỗi bước kiểm tra trên tài khoản thật **với 1–2 mục do người dùng tự chọn và đồng ý**, trước khi cho
chạy hàng loạt.
