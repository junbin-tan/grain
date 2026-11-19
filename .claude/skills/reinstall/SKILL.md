---
name: reinstall
description: Rebuild Grain from the current checkout and replace the installed /Applications/Grain.app with it, then relaunch. Use for /reinstall, "reinstall grain", "install the updated version", "update my local Grain app".
---

# /reinstall: build this checkout → /Applications/Grain.app

1. Run `scripts/reinstall.sh` from the repo root with a 600000 ms timeout (a release build takes a few minutes; run it in the background if it may take longer).
   - It refuses to run while Grain is recording (`grain-capture` is running). If so, tell the user to stop the meeting and stop here. Never kill a recording.
   - It rebuilds the capture helper, builds `llama-server` only if missing, runs `npx tauri build --bundles app`, quits the running Grain, swaps the app in `/Applications`, clears quarantine and relaunches.
2. If the build fails, show the error lines and stop. The installed app is only replaced after a successful build.
3. Report the last line (commit, and whether uncommitted changes were included). User data in `~/Library/Application Support/computer.grain.app` is not touched; no need to say more.
