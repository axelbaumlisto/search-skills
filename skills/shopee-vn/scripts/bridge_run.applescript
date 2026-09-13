-- Runner template. bridge.cjs substitutes __JS_IN__ with the real temp path before running.
set js to do shell script "cat '__JS_IN__'"
tell application "Google Chrome"
	tell active tab of first window
		set r to execute javascript js
	end tell
	if r is missing value then return "(null)"
	return (r as text)
end tell
