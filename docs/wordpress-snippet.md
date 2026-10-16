# Gửi lead từ website WordPress về Michio Sales Hub

Áp dụng cho form **"Nhận bảng giá sỉ"** (`/si-hang-nhat/`) và form **đăng ký đại lý** (`/dang-ky-dai-ly/`) — SPEC 5.1, Phụ lục B.

Nguyên tắc:
- Form vẫn gửi email như cũ. Đoạn code chỉ **gửi thêm** một bản sang Sales Hub, không chặn người dùng nếu Sales Hub lỗi (`blocking => false`, `timeout => 5`).
- API key tạo trong **Cài đặt & Tích hợp → API key cho form website** (chỉ hiện 1 lần). Không dán key vào theme public; dùng `wp-config.php`.
- Nhãn tiếng Việt ("Shop online", "10–30 triệu", "Matcha & Trà"…) được hệ thống tự nhận diện; giá trị lạ không làm mất lead (lưu nguyên trong dữ liệu gốc của lead).

## 1. Cấu hình (wp-config.php)

```php
define('MICHIO_SALES_HUB_URL', 'https://sales.michiovietnam.com/api/v1/public/leads');
define('MICHIO_SALES_HUB_KEY', 'mk_live_xxxxxxxxxxxxxxxx'); // từ màn Cài đặt
```

## 2. Hàm gửi chung (functions.php của child theme, hoặc plugin "Code Snippets")

```php
/**
 * Gửi 1 lead sang Michio Sales Hub. $form_type: 'WHOLESALE' | 'AGENT'.
 * $f: mảng đã chuẩn hoá tên trường (xem phần ánh xạ bên dưới).
 */
function michio_send_lead(string $form_type, array $f): void {
    if (!defined('MICHIO_SALES_HUB_URL') || !defined('MICHIO_SALES_HUB_KEY')) return;
    if (empty($f['fullName']) || empty($f['phone'])) return;

    $utm = [];
    foreach (['utm_source' => 'source', 'utm_medium' => 'medium', 'utm_campaign' => 'campaign'] as $cookie => $key) {
        if (!empty($_COOKIE[$cookie])) $utm[$key] = sanitize_text_field(wp_unslash($_COOKIE[$cookie]));
    }

    $body = [
        'formType'           => $form_type,
        'fullName'           => $f['fullName'],
        'phone'              => $f['phone'],
        'shopName'           => $f['shopName'] ?? null,
        'email'              => $f['email'] ?? null,
        'province'           => $f['province'] ?? null,
        'businessModel'      => $f['businessModel'] ?? null,
        'expectedOrderBand'  => $f['expectedOrderBand'] ?? null,
        'interestCategories' => array_values(array_filter((array) ($f['interestCategories'] ?? []))),
        'note'               => $f['note'] ?? null,
        'pageUrl'            => wp_get_referer() ?: home_url(add_query_arg([])),
        'utm'                => $utm ?: null,
        'website'            => '', // honeypot: luôn rỗng khi gửi từ server
    ];

    wp_remote_post(MICHIO_SALES_HUB_URL, [
        'timeout'  => 5,
        'blocking' => false, // không làm chậm form
        'headers'  => [
            'Content-Type' => 'application/json; charset=utf-8',
            'X-Api-Key'    => MICHIO_SALES_HUB_KEY,
        ],
        'body'     => wp_json_encode($body),
    ]);
}
```

> Muốn ghi log lỗi khi thử nghiệm: tạm đặt `'blocking' => true`, rồi `error_log(print_r($response, true));` — nhớ trả về `false` sau khi thử xong.

## 3. Gắn vào plugin form đang dùng `[CẦN XÁC NHẬN plugin]`

Thay tên trường (`your-name`, `ho_ten`…) cho khớp form thật. Mở form trong trang quản trị để xem tên trường.

### Contact Form 7

```php
add_action('wpcf7_mail_sent', function ($contact_form) {
    $map = [
        1234 => 'WHOLESALE', // ID form "Nhận bảng giá sỉ"
        1235 => 'AGENT',     // ID form "Đăng ký đại lý"
    ];
    $form_type = $map[$contact_form->id()] ?? null;
    if (!$form_type) return;

    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;
    $d = $submission->get_posted_data();
    $v = fn($k) => isset($d[$k]) ? (is_array($d[$k]) ? $d[$k] : trim((string) $d[$k])) : null;

    michio_send_lead($form_type, [
        'fullName'           => $v('your-name'),
        'phone'              => $v('your-phone'),
        'shopName'           => $v('shop-name'),
        'email'              => $v('your-email'),
        'province'           => is_array($v('province')) ? ($v('province')[0] ?? null) : $v('province'),
        'businessModel'      => is_array($v('business-model')) ? ($v('business-model')[0] ?? null) : $v('business-model'),
        'expectedOrderBand'  => is_array($v('order-band')) ? ($v('order-band')[0] ?? null) : $v('order-band'),
        'interestCategories' => (array) $v('categories'), // checkbox nhiều lựa chọn
        'note'               => $v('your-message'),
    ]);
});
```

### WPForms

```php
add_action('wpforms_process_complete', function ($fields, $entry, $form_data) {
    $map = [111 => 'WHOLESALE', 112 => 'AGENT']; // ID form
    $form_type = $map[(int) $form_data['id']] ?? null;
    if (!$form_type) return;

    // WPForms đánh số trường; xem ID trong trình sửa form.
    $f = fn($id) => isset($fields[$id]['value']) ? trim((string) $fields[$id]['value']) : null;
    michio_send_lead($form_type, [
        'fullName'           => $f(1),
        'phone'              => $f(2),
        'shopName'           => $f(3),
        'email'              => $f(4),
        'province'           => $f(5),
        'businessModel'      => $f(6),
        'expectedOrderBand'  => $f(7),
        'interestCategories' => array_filter(array_map('trim', explode("\n", (string) $f(8)))), // checkbox: mỗi lựa chọn 1 dòng
        'note'               => $f(9),
    ]);
}, 10, 3);
```

### Fluent Forms

```php
add_action('fluentform/submission_inserted', function ($entryId, $formData, $form) {
    $map = [3 => 'WHOLESALE', 4 => 'AGENT']; // ID form
    $form_type = $map[(int) $form->id] ?? null;
    if (!$form_type) return;

    $g = fn($k) => $formData[$k] ?? null;
    $name = $g('names');
    michio_send_lead($form_type, [
        'fullName'           => is_array($name) ? trim(implode(' ', array_filter($name))) : $name,
        'phone'              => $g('phone'),
        'shopName'           => $g('shop_name'),
        'email'              => $g('email'),
        'province'           => $g('province'),
        'businessModel'      => $g('business_model'),
        'expectedOrderBand'  => $g('order_band'),
        'interestCategories' => (array) $g('categories'),
        'note'               => $g('message'),
    ]);
}, 10, 3);
```

### Form tự viết trong theme

Gọi `michio_send_lead('WHOLESALE', [...])` ngay sau khi form được kiểm tra hợp lệ và đã gửi email.

## 4. Kiểm tra

```bash
curl -X POST https://sales.michiovietnam.com/api/v1/public/leads \
  -H "X-Api-Key: mk_live_xxx" -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @lead.json
# → 201 {"leadId":"…","code":1234,"duplicate":false,"assignedTo":"Trần Văn B"}
```

| Mã | Ý nghĩa |
|---|---|
| 201 | Tạo lead mới và đã chia |
| 200 + `duplicate: true` | Khách đang có lead mở → ghi "liên hệ lại" và báo sales đang phụ trách |
| 401 | Sai / đã thu hồi API key |
| 422 | Thiếu tên, SĐT sai định dạng |
| 429 | Quá 60 yêu cầu/phút cho một key |

Trên Windows, gửi tiếng Việt bằng file (`--data-binary @lead.json`) thay vì gõ JSON trực tiếp trong dòng lệnh để tránh lỗi mã hoá.
