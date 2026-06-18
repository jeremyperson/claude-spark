#!/bin/zsh
# Reinstall Claude Spark cleanly and make Spotlight index it.
# Run from this folder:  zsh spotlight-fix.sh

APP="/Applications/Claude Spark.app"
SRC="/Applications/MAMP/htdocs/claudeCLICharacter/release/mac-universal/Claude Spark.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"

echo "==> 1. Replacing the installed app with the fresh build"
if [ ! -d "$SRC" ]; then
  echo "    !! Source build not found at: $SRC"
  echo "    Run 'npm run dist' first, then re-run this script."
  exit 1
fi
rm -rf "$APP"
cp -R "$SRC" "$APP"

echo "==> 2. Verifying the bundle is complete"
if [ -x "$APP/Contents/MacOS/Claude Spark" ]; then
  echo "    OK: executable present"
else
  echo "    !! executable MISSING -- bundle did not copy correctly"
fi

echo "==> 3. Registering with LaunchServices"
"$LSREG" -f "$APP"

echo "==> 4. Importing into the Spotlight index"
mdimport "$APP"
sleep 3

echo "==> 5. Metadata Spotlight sees for the bundle:"
mdls -name kMDItemDisplayName -name kMDItemContentType -name kMDItemKind "$APP"

echo "==> 6. Spotlight search for 'Claude Spark':"
RESULT=$(mdfind -name "Claude Spark" 2>/dev/null | grep -i "Claude Spark.app")
if [ -n "$RESULT" ]; then
  echo "    FOUND -> $RESULT"
  echo ""
  echo ">>> SUCCESS: Spotlight can see Claude Spark. Try Cmd-Space now."
else
  echo "    (not in the index yet)"
  echo ""
  echo ">>> Not indexed yet. If 'sudo mdutil -E /' is still rebuilding, wait a"
  echo "    few minutes and re-run this script. If metadata in step 5 was blank,"
  echo "    tell Claude -- the bundle itself is the problem."
fi
