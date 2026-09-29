#!/bin/bash
# End-to-end test of the desktop shell on Linux: Xvfb + a Secret Service keychain + a real server on 7777.
#   cd desktop/src-tauri && cargo build && cargo build --example keytool && cd ../..
#   dbus-run-session -- bash desktop/test-gui.sh /tmp/hw-gui
# Needs: Xvfb, gnome-keyring, ImageMagick (import). Screenshots land in the given directory:
#   A-launcher (the server found on the LAN), B-game (logged in from the keychain), C-after-rotate (the dead key dropped).
set -u
G=${1:?output directory}; mkdir -p "$G/home"; R=$(cd "$(dirname "$0")/.." && pwd); APP=$R/desktop/src-tauri/target/debug/hogwarts-desktop; KT=$R/desktop/src-tauri/target/debug/examples/keytool
export HOME=$G/home XDG_CONFIG_HOME=$G/home/.config XDG_DATA_HOME=$G/home/.local/share
Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 & XV=$!
export DISPLAY=:99
printf 'pw' | gnome-keyring-daemon --unlock --replace --daemonize --components=secrets >/dev/null 2>&1
sleep 1
(cd $R && exec env PORT=7777 HOGWARTS_DATA=$G/world.json NPC_COUNT=0 HOGWARTS_NAME="测试城堡" node --import tsx src/server/main.ts > $G/server.log 2>&1) & SV=$!
for i in $(seq 1 60); do curl -s --noproxy '*' http://127.0.0.1:7777/api/version >/dev/null && break; sleep 1; done
LAN=$(hostname -I | awk '{print $1}'); ORIGIN="http://$LAN:7777"
echo "origin $ORIGIN"
shot() { import -window root "$G/$1.png" 2>/dev/null; echo "shot $1"; }
players() { curl -s --noproxy '*' http://127.0.0.1:7777/api/version | sed 's/.*"players":\([0-9]*\).*/\1/'; }

# A: first launch, nothing saved: the launcher finds the server on the LAN by itself
$APP > $G/appA.log 2>&1 & AP=$!
sleep 15; shot A-launcher; kill $AP; wait $AP 2>/dev/null

# B: a key in the keychain and a last server: straight into the world, logged in
TOKEN=$(curl -s --noproxy '*' -X POST http://127.0.0.1:7777/api/enroll -d '{"name":"Desk Wizard"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
$KT set "$ORIGIN" "$TOKEN"; echo "B keychain seeded: $($KT get "$ORIGIN" | cut -c1-4)…"
CFG=$XDG_CONFIG_HOME/io.github.cklxx.hogwarts; mkdir -p $CFG
printf '{"last":"%s","known":["%s"]}' "$ORIGIN" "$ORIGIN" > $CFG/servers.json
$APP > $G/appB.log 2>&1 & AP=$!
for i in $(seq 1 90); do [ "$(players)" = "1" ] && break; sleep 1; done
echo "B players online: $(players)"
sleep 40; shot B-game

# C: the key is rotated elsewhere (an agent's rotate_key): the page drops the dead key, and so does the keychain
printf '%s' "$TOKEN" > $G/me.key; chmod 600 $G/me.key
(cd $R && npx tsx scripts/playtest/mcp.ts --url http://127.0.0.1:7777/mcp --me $G/me.key rotate_key '{}' > $G/rotate.log 2>&1)
sleep 8
if $KT get "$ORIGIN" >/dev/null 2>&1; then echo "C keychain after rotate: $([ "$($KT get "$ORIGIN")" = "$TOKEN" ] && echo 'still old key' || echo 'new key')"; else echo "C keychain after rotate: removed"; fi
shot C-after-rotate
kill $AP; wait $AP 2>/dev/null
kill $SV; wait $SV 2>/dev/null
kill $XV
