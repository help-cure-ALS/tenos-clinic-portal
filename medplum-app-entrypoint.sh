#!/bin/sh
# Replace placeholder tokens in the medplum-app JS bundle with actual config values
MEDPLUM_BASE_URL="${MEDPLUM_BASE_URL:-http://localhost:8070/api/}"
MEDPLUM_CLIENT_ID="${MEDPLUM_CLIENT_ID:-}"
MEDPLUM_REGISTER_ENABLED="${MEDPLUM_REGISTER_ENABLED:-true}"

for f in /usr/share/nginx/html/assets/index-*.js; do
  sed -i "s|__MEDPLUM_BASE_URL__|${MEDPLUM_BASE_URL}|g" "$f"
  sed -i "s|__MEDPLUM_CLIENT_ID__|${MEDPLUM_CLIENT_ID}|g" "$f"
  sed -i "s|__MEDPLUM_REGISTER_ENABLED__|${MEDPLUM_REGISTER_ENABLED}|g" "$f"
  # Remove unused placeholders (Google, reCAPTCHA) — leave empty
  sed -i "s|__GOOGLE_CLIENT_ID__||g" "$f"
  sed -i "s|__RECAPTCHA_SITE_KEY__||g" "$f"
done

echo "Patched medplum-app config:"
echo "  baseUrl:          ${MEDPLUM_BASE_URL}"
echo "  clientId:         ${MEDPLUM_CLIENT_ID:-<empty>}"
echo "  registerEnabled:  ${MEDPLUM_REGISTER_ENABLED}"

# Start nginx (original entrypoint)
exec nginx -g 'daemon off;'
