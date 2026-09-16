-- Resident job server for ChromeBridge.app.
--
-- Launched ONCE (`open -g -j`), then stays alive polling for jobs, so a command that
-- needs ten JS calls costs one app launch instead of ten focus-stealing relaunches.
-- It survives between CLI invocations and quits itself after ~2 min idle.
--
-- Protocol (all under /tmp):
--   shopee_job.js    job payload, JS source
--   shopee_job.go    flag: a job is ready; server deletes it when done
--   shopee_job.out   result: "OK <text>" / "ERR <num> <msg>"
--   shopee_job.hb    heartbeat, rewritten every tick so Node knows we are alive
--   shopee_job.quit  flag: shut down
--
-- JS runs in a DEDICATED tab (id remembered in /tmp/shopee_tab.id), never in the tab
-- the user is reading. File IO is native AppleScript, not `do shell script`: it avoids
-- a shell spawn per tick and any quoting trouble with Thai/Vietnamese text.

-- NB: `open for access` CREATES a missing file even when opened for reading, so using it
-- as an existence test made the server see its own quit flag on the first tick and exit.
-- Coercing to alias fails cleanly instead, and creates nothing.
on fileExists(p)
	try
		POSIX file p as alias
		return true
	on error
		return false
	end try
end fileExists

on writeFile(p, t)
	set fh to open for access POSIX file p with write permission
	try
		set eof fh to 0
		write t to fh as «class utf8»
	end try
	close access fh
end writeFile

on readFile(p)
	return read POSIX file p as «class utf8»
end readFile

on killFile(p)
	try
		do shell script "rm -f " & quoted form of p
	end try
end killFile

on bridgeTab()
	set idFile to "/tmp/shopee_tab.id"
	set wantId to ""
	if my fileExists(idFile) then
		try
			set wantId to my readFile(idFile)
		end try
	end if
	tell application "Google Chrome"
		if wantId is not "" then
			repeat with w in windows
				repeat with t in tabs of w
					try
						if ((id of t) as text) is wantId then return t
					end try
				end repeat
			end repeat
		end if
		set nw to make new window
		set nt to active tab of nw
		my writeFile(idFile, ((id of nt) as text))
		return nt
	end tell
end bridgeTab

on run
	set jobFile to "/tmp/shopee_job.js"
	set goFile to "/tmp/shopee_job.go"
	set outFile to "/tmp/shopee_job.out"
	set quitFile to "/tmp/shopee_job.quit"
	set hbFile to "/tmp/shopee_job.hb"

	set idleTicks to 0
	repeat
		try
			my writeFile(hbFile, (current date) as text)
		end try

		if my fileExists(quitFile) then
			my killFile(quitFile)
			exit repeat
		end if

		if my fileExists(goFile) then
			set idleTicks to 0
			set txt to "ERR 0 no-job"
			try
				set js to my readFile(jobFile)
				set tb to my bridgeTab()
				tell application "Google Chrome"
					tell tb
						set r to execute javascript js
					end tell
				end tell
				if r is missing value then
					set txt to "OK (null)"
				else
					set txt to "OK " & (r as text)
				end if
			on error errMsg number errNum
				set txt to "ERR " & errNum & " " & errMsg
			end try
			try
				my writeFile(outFile, txt)
			end try
			my killFile(goFile)
		else
			set idleTicks to idleTicks + 1
			if idleTicks > 480 then exit repeat
			delay 0.25
		end if
	end repeat
	return "server-stopped"
end run
