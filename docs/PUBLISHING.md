# Phát hành lên Chrome Web Store

> **Trạng thái (26/11/2026): CHƯA phát hành.** Chờ thêm tính năng và cải tiến rồi đưa lên một lần.
> Hiện extension đang được cài theo kiểu "Load unpacked" từ `dist/`.

## 1. Chuẩn bị bản đóng gói

```bash
npm run pack    # typecheck -> build release vào release/unpacked/ -> zip vào release/
```

Kết quả là `release/contacts-rail-<version>.zip`. Đây là bản release, không chứa code dev
(dev-reload, `__DEV__`). Luôn nộp file zip này, **không** nộp `dist/`.

## 2. Các bước lên store

1. **Tài khoản developer** (một lần): https://chrome.google.com/webstore/devconsole
   - Phí đăng ký 5 USD, trả một lần.
   - Tài khoản Google bắt buộc bật xác minh 2 bước. Nên dùng một tài khoản riêng cho việc phát hành.
2. **New item**: upload file zip.
3. **Store listing**:
   - Mô tả tiếng Anh và tiếng Việt (extension đã có cả hai locale).
   - Ít nhất 1 ảnh chụp màn hình 1280×800 hoặc 640×400.
   - Icon 128px: `src/icons/128.png`.
4. **Tab Privacy** (phần dễ bị trả về nhất):
   - Single purpose: "Hiện lại danh sách liên hệ ở cột phải Facebook."
   - Giải thích từng quyền:
     - `storage`: lưu cài đặt, người được ghim, người bị ẩn.
     - `notifications`: báo khi một người bạn chọn bắt đầu hoạt động.
     - `declarativeNetRequest`: gỡ header `X-Frame-Options` để nhúng Messenger vào panel, chỉ cho
       frame do chính facebook.com mở.
     - Quyền truy cập `facebook.com`: đọc danh sách hộp thư.
   - Remote code: **Không**.
   - Privacy policy URL: cần một link công khai. Có thể dùng `PRIVACY.md` trên GitHub, nhưng repo
     `fb-sidekick` phải để public, hoặc đăng file đó ở một nơi công khai khác.
5. **Phạm vi phát hành**:
   - **Public**: ai cũng tìm thấy trên store.
   - **Unlisted**: chỉ người có link mới cài được, hợp nếu chỉ chia cho bạn bè.
   - **Private**: chỉ người trong danh sách được cho phép.
6. **Submit for review**: thường mất vài ngày.

### Rủi ro khi duyệt

Extension này có thể bị xét kỹ hơn vì:

- Sửa header trên facebook.com (`rules/frame-headers.json`) và tự bấm các nút xoá của Messenger.
- Tên có chữ "for Facebook": chính sách store cấm gây hiểu nhầm là sản phẩm chính thức. Cách đặt
  "X for Facebook" thường được chấp nhận, nhưng icon không được giống logo Facebook.

Nếu bị từ chối, email sẽ nêu lý do cụ thể để sửa rồi gửi lại.

## 3. Cập nhật tự động

Người cài từ Chrome Web Store được cập nhật tự động. Chrome tự kiểm tra định kỳ và cài bản mới
trong vòng vài giờ sau khi bản đó được duyệt.

Mỗi lần ra bản mới:

1. Tăng `version` trong `src/manifest.json` và `package.json` (cả `package-lock.json`). Số mới bắt
   buộc phải lớn hơn số cũ.
2. `npm run pack`.
3. Trên trang quản lý: **Package → Upload new package**, rồi **Submit for review**.

### Lưu ý

- **Đừng thêm quyền mới nếu không thật cần.** Nếu bản mới xin thêm quyền có kèm cảnh báo, Chrome
  sẽ tắt extension trên máy người dùng cho đến khi họ tự bấm đồng ý.
- **Bản "Load unpacked" không tự cập nhật.** Ai đang cài kiểu này (kể cả máy hiện tại) cần gỡ ra rồi
  cài lại từ store. Bản trên store có ID khác, nên cài đặt và danh sách ghim, ẩn, thông báo
  (`chrome.storage` gắn theo ID extension) sẽ bị reset một lần.
- **Không có đường tắt ngoài store.** Tự host file kèm `update_url` không dùng được cho người dùng
  Windows hay Mac thông thường; Chrome chỉ cho phép cách đó qua chính sách quản lý doanh nghiệp.

## 4. Việc có thể chuẩn bị trước khi nộp

- Soạn mô tả store (EN + VI) và lời giải thích từng quyền.
- Chụp ảnh màn hình 1280×800 của panel trên Facebook (che tên, ảnh của người thật).
- Đưa `PRIVACY.md` lên một URL công khai.
- Kiểm tra lại icon và tên không giống nhận diện của Facebook.
