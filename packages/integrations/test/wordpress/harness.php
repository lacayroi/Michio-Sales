<?php
// Minimal WordPress / Contact Form 7 / WPForms stand-ins to exercise the mu-plugin from docs/wordpress-snippet.md.
// Usage: php harness.php <plugin.php> <scenario>. Prints captured wp_remote_post calls as JSON.

define('ABSPATH', __DIR__ . '/');
define('MICHIO_HUB_URL', 'https://hub.test/api/v1/public/leads');
define('MICHIO_HUB_API_KEY', 'mk_test_harness');

$GLOBALS['__actions'] = array();
$GLOBALS['__requests'] = array();
$GLOBALS['__fail_http'] = false;

function add_action($hook, $cb, $priority = 10, $args = 1) { $GLOBALS['__actions'][$hook][] = $cb; }
function do_action($hook, ...$args) { foreach ($GLOBALS['__actions'][$hook] ?? array() as $cb) { $cb(...$args); } }
function apply_filters($hook, $value) { return $value; }
function wp_json_encode($v) { return json_encode($v, JSON_UNESCAPED_UNICODE); }
function wp_unslash($v) { return is_string($v) ? stripslashes($v) : $v; }
function wp_remote_post($url, $args) {
    if ($GLOBALS['__fail_http']) { throw new RuntimeException('cURL error 28: Connection timed out'); }
    $GLOBALS['__requests'][] = array('url' => $url, 'args' => $args);
    return array('response' => array('code' => 201));
}

class WPCF7_ContactForm { private $id; function __construct($id) { $this->id = $id; } function id() { return $this->id; } }
class WPCF7_Submission {
    public static $current = null;
    private $data; private $url;
    function __construct($data, $url) { $this->data = $data; $this->url = $url; }
    static function get_instance() { return self::$current; }
    function get_posted_data() { return $this->data; }
    function get_meta($k) { return $k === 'url' ? $this->url : null; }
}

$scenario = $argv[2] ?? 'default';
if ($scenario === 'whitelist') {
    // Only CF7 #123 is configured, and as an agent form: URL-based detection must be bypassed.
    define('MICHIO_HUB_FORMS', array('cf7:123' => 'AGENT'));
}
require $argv[1];
$out = array();

// 1) Contact Form 7 on /si-hang-nhat/ with typical field names, checkbox array, UTM in URL.
WPCF7_Submission::$current = new WPCF7_Submission(array(
    'your-name' => 'Nguyễn Thị Hoa', 'your-phone' => '0912 345 678', 'ten-shop' => 'Shop Mẹ & Bé Hoa', 'your-email' => 'hoa@example.com',
    'tinh-thanh' => 'Hải Phòng', 'mo-hinh' => 'Shop online', 'muc-nhap' => '10–30 triệu',
    'nhom-hang' => array('Matcha & Trà', 'Thực phẩm'), 'your-message' => 'Muốn lấy matcha latte và bánh kẹo cho bé', 'website' => '',
), 'https://michiovietnam.com/si-hang-nhat/?utm_source=facebook&utm_medium=cpc&utm_campaign=si-thang11');
do_action('wpcf7_mail_sent', new WPCF7_ContactForm(123));

// 2) WPForms on /dang-ky-dai-ly/: fields matched by Vietnamese labels, checkbox values newline-separated.
$_POST['page_url'] = 'https://michiovietnam.com/dang-ky-dai-ly/';
do_action('wpforms_process_complete', array(
    1 => array('name' => 'Họ và tên', 'value' => 'Trần Văn Bình', 'type' => 'name'),
    2 => array('name' => 'Số điện thoại', 'value' => '0983.111.222', 'type' => 'phone'),
    3 => array('name' => 'Tên shop/doanh nghiệp', 'value' => 'Công ty TNHH Bình An', 'type' => 'text'),
    4 => array('name' => 'Tỉnh/Thành', 'value' => 'Đà Nẵng', 'type' => 'select'),
    5 => array('name' => 'Mô hình kinh doanh', 'value' => 'Doanh nghiệp / đối tác phân phối', 'type' => 'select'),
    6 => array('name' => 'Mức nhập dự kiến', 'value' => 'Trên 50 triệu', 'type' => 'select'),
    7 => array('name' => 'Nhóm hàng quan tâm', 'value' => "Đồ uống\nGia dụng", 'type' => 'checkbox'),
    8 => array('name' => 'Ghi chú', 'value' => 'Muốn làm đại lý miền Trung', 'type' => 'textarea'),
), array(), array('id' => 456), 99);

// 3) Unrelated contact form (other page, no whitelist) → must be ignored.
WPCF7_Submission::$current = new WPCF7_Submission(array('your-name' => 'Khách hỏi', 'your-phone' => '0912000111'), 'https://michiovietnam.com/lien-he/');
do_action('wpcf7_mail_sent', new WPCF7_ContactForm(999));

// 4) Missing phone → not sent (Sales Hub requires it).
WPCF7_Submission::$current = new WPCF7_Submission(array('your-name' => 'Không SĐT'), 'https://michiovietnam.com/si-hang-nhat/');
do_action('wpcf7_mail_sent', new WPCF7_ContactForm(123));

$out['requests'] = $GLOBALS['__requests'];

// 5) Network failure must not bubble up to the form.
$GLOBALS['__fail_http'] = true;
$GLOBALS['__requests'] = array();
WPCF7_Submission::$current = new WPCF7_Submission(array('your-name' => 'A', 'your-phone' => '0912345679'), 'https://michiovietnam.com/si-hang-nhat/');
$threw = false;
try { do_action('wpcf7_mail_sent', new WPCF7_ContactForm(123)); } catch (Throwable $e) { $threw = true; }
$out['failureBubbled'] = $threw;

echo json_encode($out, JSON_UNESCAPED_UNICODE);
