#!/usr/bin/env bash
# Build ChromeBridge.app — the trusted AppleScript applet that runs JS inside the
# user's real, logged-in Chrome. Shopee refuses cart writes from any automated browser.
#
#   ./build_bridge.sh                 # installs to ~/Applications/ChromeBridge.app
#   SHOPEE_BRIDGE_DIR=/tmp/x ./build_bridge.sh   # must match the value used at runtime
#
# Why an applet and not `osascript` directly:
#   * macOS binds Automation (TCC) permission to a *bundle identifier*. A bare script
#     has none, so every call re-prompts or silently fails.
#   * `~/Applications` is deliberate: system permission pickers cannot browse into a
#     dotted path like ~/.config, so an applet hidden there can never be granted by hand.
set -euo pipefail

APP="${SHOPEE_BRIDGE_APP:-$HOME/Applications/ChromeBridge.app}"
DIR="${SHOPEE_BRIDGE_DIR:-${BRIDGE_DIR:-$HOME/.config/search-skills/bridge}}"
BUNDLE_ID="${BRIDGE_BUNDLE_ID:-works.search-skills.chromebridge}"
TD="$(mktemp -d)"; SRC="$TD/chromebridge.applescript"
trap 'rm -rf "$TD"' EXIT

mkdir -p "$(dirname "$APP")" "$DIR"
chmod 700 "$DIR"

cat > "$SRC" <<AS
-- Generic runner: executes the AppleScript staged by bridge.cjs inside this trusted
-- bundle, so the script can be iterated without re-triggering the Automation prompt.
on run
	set outFile to "$DIR/shopee_js.out"
	try
		set res to run script (POSIX file "$DIR/shopee_as.applescript")
		if res is missing value then
			set txt to "OK (null)"
		else
			set txt to "OK " & (res as text)
		end if
	on error errMsg number errNum
		set txt to "ERR " & errNum & " " & errMsg
	end try
	do shell script "printf '%s' " & quoted form of txt & " > " & quoted form of outFile
end run
AS

rm -rf "$APP"
osacompile -o "$APP" "$SRC"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Contents/Info.plist"
# An ad-hoc signature gives the bundle a stable TCC identity that survives edits.
codesign --force --deep -s - "$APP"

cat <<MSG
built: $APP   (bundle id: $BUNDLE_ID, staging dir: $DIR)

Two manual steps, once per machine:
  1. Run any cart command; approve "ChromeBridge wants to control Google Chrome".
     In a detached tmux no prompt can appear — run it from a real terminal once.
  2. Chrome: View > Developer > Allow JavaScript from Apple Events.
     Writing the pref into Local State/Preferences does NOT work; only the menu does.
MSG
