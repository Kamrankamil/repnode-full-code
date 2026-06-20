<?php
// Simple router for PHP built-in server to funnel requests to server.php
// Allows static files to be served directly and silences socketcluster pings.

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';

// Serve static files if they exist
if ($path !== '/' && file_exists(__DIR__ . $path) && !is_dir(__DIR__ . $path)) {
    return false; // let built-in server handle the file
}

// Silence socketcluster health/ping hits that some frontends send
if ($path === '/socketcluster' || $path === '/socketcluster/') {
    http_response_code(204);
    exit;
}

// Default: forward everything to server.php
require __DIR__ . '/server.php';
