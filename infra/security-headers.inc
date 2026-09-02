# Included at server level and again in every location that defines its own add_header.
# Nginx otherwise stops inheriting all parent add_header directives as soon as a child adds one.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: https:; frame-src https://*.wikipedia.org https://www.openstreetmap.org https://*.mapillary.com https://embed.windy.com https://opentopomap.org https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; report-uri /api/security/csp-report" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), payment=(), usb=()" always;
