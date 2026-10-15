# Kết nối form WordPress → Michio Sales Hub

Gửi lead từ form **"Nhận bảng giá sỉ"** (`/si-hang-nhat/`) và **"Đăng ký đại lý"** (`/dang-ky-dai-ly/`) sang Sales Hub ngay khi khách bấm gửi (SPEC 5.1, Phụ lục B).

Michio chưa xác nhận đang dùng plugin form nào, nên đoạn code dưới đây hỗ trợ **cả Contact Form 7 và WPForms**. Plugin nào không có trên site thì hook của nó không bao giờ chạy, không ảnh hưởng gì.

- Form vẫn gửi email như cũ. Nếu Sales Hub lỗi hoặc chậm, khách **không** bị ảnh hưởng: request gửi nền (`blocking => false`), timeout 5 giây, mọi lỗi đều bị nuốt.
- Không cần sửa theme. Code là một **mu-plugin** (plugin bắt buộc, không tắt nhầm được trong trang quản trị).

## 1. Lấy API key

Sales Hub → **Cài đặt & Tích hợp → API key website → Tạo key**. Key chỉ hiện **một lần**, dạng `mk_live_…`.

## 2. Khai báo trong `wp-config.php`

Thêm phía trên dòng `/* That's all, stop editing! */`:

```php
define('MICHIO_HUB_URL', 'https://sales.michiovietnam.com/api/v1/public/leads');
define('MICHIO_HUB_API_KEY', 'mk_live_xxxxxxxxxxxxxxxx');

// Tùy chọn — chỉ gửi các form này (khuyến nghị). Bỏ trống thì nhận diện theo đường dẫn trang.
// Contact Form 7: ID trong shortcode [contact-form-7 id="123"]; WPForms: ID trong [wpforms id="456"].
define('MICHIO_HUB_FORMS', [
    'cf7:123'     => 'WHOLESALE', // form "Nhận bảng giá sỉ"
    'cf7:124'     => 'AGENT',     // form "Đăng ký đại lý"
    'wpforms:456' => 'WHOLESALE',
]);
```

## 3. Cài mu-plugin

Tạo file `wp-content/mu-plugins/michio-sales-hub-leads.php` (tạo thư mục `mu-plugins` nếu chưa có) với nội dung:

```php
<?php
/**
 * Plugin Name: Michio Sales Hub — gửi lead từ form
 * Description: Gửi form "Nhận bảng giá sỉ" / "Đăng ký đại lý" (Contact Form 7 hoặc WPForms) sang Michio Sales Hub.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Tên trường trong form → trường của Sales Hub.
 * Contact Form 7 so khớp theo *tên* trường (vd [text* your-name]); WPForms so khớp theo *nhãn* trường.
 * So khớp không phân biệt hoa thường và dấu tiếng Việt. Thêm tên/nhãn khác qua filter 'michio_hub_field_aliases'.
 */
function michio_hub_field_aliases() {
    return apply_filters('michio_hub_field_aliases', array(
        'fullName'           => array('your-name', 'ho-ten', 'ho-va-ten', 'fullname', 'name', 'ho va ten', 'ho ten', 'ten'),
        'phone'              => array('your-phone', 'so-dien-thoai', 'sdt', 'phone', 'tel', 'so dien thoai', 'dien thoai'),
        'shopName'           => array('ten-shop', 'shop', 'company', 'ten shop/doanh nghiep', 'ten shop', 'ten doanh nghiep'),
        'email'              => array('your-email', 'email', 'e-mail'),
        'province'           => array('tinh-thanh', 'province', 'tinh/thanh', 'tinh thanh', 'tinh/thanh pho'),
        'businessModel'      => array('mo-hinh', 'mo-hinh-kinh-doanh', 'business-model', 'mo hinh kinh doanh'),
        'expectedOrderBand'  => array('muc-nhap', 'muc-nhap-du-kien', 'order-band', 'muc nhap du kien'),
        'interestCategories' => array('nhom-hang', 'nhom-hang-quan-tam', 'categories', 'nhom hang quan tam'),
        'note'               => array('your-message', 'ghi-chu', 'message', 'note', 'ghi chu', 'loi nhan'),
        'website'            => array('website'), // honeypot: phải để trống
    ));
}

/** Bỏ dấu, viết thường, gộp khoảng trắng: "Số điện thoại" → "so dien thoai". */
function michio_hub_fold($text) {
    $text = trim((string) $text);
    if (function_exists('remove_accents')) {
        $text = remove_accents($text);
    } elseif (function_exists('iconv')) {
        $text = str_replace(array('đ', 'Đ'), array('d', 'D'), $text);
        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
        if ($converted !== false) {
            $text = $converted;
        }
    }
    $text = strtolower(str_replace(array('*', ':'), '', $text));
    return trim(preg_replace('/\s+/', ' ', $text));
}

/** $fields: danh sách [khóa (tên hoặc nhãn), giá trị]. Trả về payload theo Phụ lục B. */
function michio_hub_build_payload(array $fields, $form_type, $page_url) {
    $payload = array('formType' => $form_type, 'pageUrl' => (string) $page_url, 'interestCategories' => array());
    $aliases = michio_hub_field_aliases();
    foreach ($fields as $pair) {
        $key = michio_hub_fold($pair[0]);
        $value = $pair[1];
        foreach ($aliases as $target => $names) {
            if (!in_array($key, $names, true) || (isset($payload[$target]) && $target !== 'interestCategories')) {
                continue;
            }
            if ($target === 'interestCategories') {
                $list = is_array($value) ? $value : preg_split('/[\r\n,;]+/', (string) $value);
                $payload[$target] = array_values(array_filter(array_map('trim', array_map('strval', $list)), 'strlen'));
            } else {
                $payload[$target] = is_array($value) ? implode(', ', array_map('strval', $value)) : trim((string) $value);
            }
            break;
        }
    }
    // UTM: từ trường ẩn (utm_source…) nếu form có, nếu không thì từ query string của trang.
    $utm = array();
    $query = array();
    $parsed = parse_url((string) $page_url, PHP_URL_QUERY);
    if ($parsed) {
        parse_str($parsed, $query);
    }
    foreach (array('source', 'medium', 'campaign', 'content', 'term') as $part) {
        foreach ($fields as $pair) {
            if (michio_hub_fold($pair[0]) === 'utm_' . $part && $pair[1] !== '') {
                $utm[$part] = (string) $pair[1];
            }
        }
        if (!isset($utm[$part]) && !empty($query['utm_' . $part])) {
            $utm[$part] = (string) $query['utm_' . $part];
        }
    }
    if ($utm) {
        $payload['utm'] = $utm;
    }
    return $payload;
}

/** 'WHOLESALE' | 'AGENT' | null (null = form không liên quan, không gửi). */
function michio_hub_form_type($plugin, $form_id, $page_url) {
    if (defined('MICHIO_HUB_FORMS') && is_array(MICHIO_HUB_FORMS) && count(MICHIO_HUB_FORMS) > 0) {
        $key = $plugin . ':' . $form_id;
        return isset(MICHIO_HUB_FORMS[$key]) ? MICHIO_HUB_FORMS[$key] : null;
    }
    if (strpos((string) $page_url, 'dang-ky-dai-ly') !== false) {
        return 'AGENT';
    }
    if (strpos((string) $page_url, 'si-hang-nhat') !== false) {
        return 'WHOLESALE';
    }
    return null;
}

function michio_hub_send(array $payload) {
    if (!defined('MICHIO_HUB_URL') || !defined('MICHIO_HUB_API_KEY')) {
        return;
    }
    if (empty($payload['fullName']) || empty($payload['phone'])) {
        return; // Sales Hub yêu cầu họ tên + SĐT
    }
    try {
        wp_remote_post(MICHIO_HUB_URL, array(
            'timeout'     => 5,
            'blocking'    => false, // không bắt khách chờ; lỗi phía Sales Hub không ảnh hưởng form
            'headers'     => array('Content-Type' => 'application/json', 'X-Api-Key' => MICHIO_HUB_API_KEY),
            'body'        => wp_json_encode($payload),
            'data_format' => 'body',
        ));
    } catch (\Throwable $e) {
        if (function_exists('error_log')) {
            error_log('[michio-sales-hub] ' . $e->getMessage());
        }
    }
}

// ---------- Contact Form 7 ----------
add_action('wpcf7_mail_sent', function ($contact_form) {
    try {
        if (!class_exists('WPCF7_Submission')) {
            return;
        }
        $submission = WPCF7_Submission::get_instance();
        if (!$submission) {
            return;
        }
        $page_url = (string) $submission->get_meta('url');
        $type = michio_hub_form_type('cf7', $contact_form->id(), $page_url);
        if (!$type) {
            return;
        }
        $fields = array();
        foreach ((array) $submission->get_posted_data() as $name => $value) {
            $fields[] = array($name, $value);
        }
        michio_hub_send(michio_hub_build_payload($fields, $type, $page_url));
    } catch (\Throwable $e) {
        // Không bao giờ làm hỏng việc gửi form.
    }
});

// ---------- WPForms ----------
add_action('wpforms_process_complete', function ($fields, $entry, $form_data, $entry_id) {
    try {
        $page_url = isset($_POST['page_url']) ? (string) wp_unslash($_POST['page_url'])
            : (isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : '');
        $form_id = isset($form_data['id']) ? $form_data['id'] : '';
        $type = michio_hub_form_type('wpforms', $form_id, $page_url);
        if (!$type) {
            return;
        }
        $pairs = array();
        foreach ((array) $fields as $field) {
            $label = isset($field['name']) ? $field['name'] : '';
            $value = isset($field['value']) ? $field['value'] : '';
            // Trường "Name" dạng họ/tên tách đôi: WPForms gộp sẵn vào 'value'.
            $pairs[] = array($label, $value);
        }
        michio_hub_send(michio_hub_build_payload($pairs, $type, $page_url));
    } catch (\Throwable $e) {
        // Không bao giờ làm hỏng việc gửi form.
    }
}, 10, 4);
```

## 4. Kiểm tra

1. Gửi thử form sỉ trên website bằng SĐT của bạn.
2. Trong vòng vài giây, lead hiện ở Sales Hub → **Lead**, nguồn "Form sỉ" và đã được chia cho một sales.
3. Không thấy lead:
   - Kiểm tra `MICHIO_HUB_URL` (phải là `https://…/api/v1/public/leads`) và API key chưa bị thu hồi.
   - Nếu dùng `MICHIO_HUB_FORMS`, kiểm tra đúng ID form và đúng tiền tố `cf7:` / `wpforms:`.
   - Tên trường khác mặc định? Thêm vào aliases trong file mu-plugin, hoặc khai báo filter trong `functions.php` của theme:

```php
add_filter('michio_hub_field_aliases', function ($aliases) {
    $aliases['phone'][] = 'dien-thoai-lien-he'; // tên trường CF7 hoặc nhãn WPForms (không dấu, viết thường)
    return $aliases;
});
```

## Ánh xạ giá trị

Sales Hub nhận **nhãn tiếng Việt hoặc mã** (SPEC 5.1). Ví dụ: "Shop online" → `ONLINE_SHOP`, "10–30 triệu" → `B10_30M`, "Matcha & Trà" → `MATCHA_TEA`. Nhãn lạ vẫn nhận lead (ghi là `OTHER` / `UNKNOWN`) để không mất khách.

## Đã kiểm thử

`packages/core/src/wordpress-snippet.int.test.ts` trích **đúng khối PHP ở mục 3** của tài liệu này, chạy trong PHP 8.3 với WordPress/CF7/WPForms giả lập (`packages/integrations/test/wordpress/harness.php`). Test kiểm tra request gửi đi (URL, header `X-Api-Key`, timeout 5 giây, không chặn), lỗi mạng không làm hỏng form, form không liên quan bị bỏ qua, rồi đưa payload vào Sales Hub và xác nhận lead được tạo và chia.
