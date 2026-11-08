<?php
/* Tiny JSON file API for LionTorrent. Upload to ~/www/files.php (SFTP).
 * All paths are jailed to /home/kitan. Auth is inherited from lighttpd
 * basic auth on /user-kitan/; refuse to run unauthenticated (public dir). */
if (empty($_SERVER['REMOTE_USER'])) { http_response_code(401); exit('auth required'); }

const ROOT = '/home/kitan';
const DENY = ['session', 'downloads.tmp', 'www']; // rtorrent session etc. hidden at root

if (!function_exists('jail')) {
  function jail(string $p): string {
    $real = realpath(ROOT . '/' . $p);
    if ($real === false || !str_starts_with($real, ROOT . '/')) { http_response_code(403); exit('path outside jail'); }
    $rel = ltrim(substr($real, strlen(ROOT)), '/');
    if (str_contains($rel . '/', '/.lighttpd/') || str_contains($rel . '/', '/..')) { http_response_code(403); exit('forbidden path'); }
    if (count(explode('/', $rel)) === 1 && str_starts_with($rel, '.')) { http_response_code(403); exit('hidden file'); }
    return $rel;
  }
}

$action = $_GET['action'] ?? '';
$path = $_GET['path'] ?? '';
$rel = $action === 'upload' ? jail(dirname($path)) : ($path !== '' ? jail($path) : '');
$full = ROOT . '/' . $rel;

switch ($action) {
  case 'list':
    if (!is_dir($full)) { http_response_code(404); exit('no such dir'); }
    header('Content-Type: application/json');
    $out = [];
    foreach (scandir($full, SCANDIR_SORT_ASCENDING) as $name) {
      if ($name === '.' || str_starts_with($name, '.')) continue;
      $f = "$full/$name";
      $out[] = [
        'name' => $name,
        'dir' => is_dir($f),
        'size' => is_dir($f) ? null : filesize($f),
        'mtime' => filemtime($f),
      ];
    }
    echo json_encode(['path' => $rel, 'entries' => $out]);
    break;

  case 'mkdir':
    if (!@mkdir($full, 0775, true) && !is_dir($full)) { http_response_code(500); exit('mkdir failed'); }
    echo 'ok';
    break;

  case 'rename':
    if (!isset($_GET['to'])) { http_response_code(400); exit('missing to'); }
    if (basename(jail($_GET['to'])) !== basename($_GET['to'])) { http_response_code(403); exit('cross-dir move via rename not allowed'); }
    if (!@rename($full, ROOT . '/' . jail($_GET['to']))) { http_response_code(500); exit('rename failed'); }
    echo 'ok';
    break;

  case 'delete':
    if (is_dir($full)) {
      $it = new FilesystemIterator($full, FilesystemIterator::SKIP_DOTS);
      if ($it->valid()) { http_response_code(400); exit('dir not empty'); }
      rmdir($full);
    } else {
      unlink($full);
    }
    echo 'ok';
    break;

  case 'download':
    if (!is_file($full)) { http_response_code(404); exit('no such file'); }
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize($full));
    header('Content-Disposition: attachment; filename="' . rawurlencode(basename($full)) . '"');
    readfile($full);
    break;

  case 'upload':
    foreach ($_FILES as $file) {
      if ($file['error'] !== UPLOAD_ERR_OK) { http_response_code(500); exit('upload error'); }
      $dest = ROOT . '/' . $rel . '/' . basename($file['name']);
      if (!str_starts_with(realpath(dirname($dest)), ROOT)) { http_response_code(403); exit('bad upload path'); }
      move_uploaded_file($file['tmp_name'], $dest);
    }
    echo 'ok';
    break;

  default:
    http_response_code(400);
    exit('unknown action');
}
