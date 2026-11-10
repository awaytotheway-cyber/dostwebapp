#!/usr/bin/env bash
# VAD parity: the shipping Swift detector against the shipping Kotlin one,
# on identical audio. Exits non-zero on any difference.
#
# Needs swiftc (5.8+), kotlinc and java on PATH, or SWIFTC / KOTLINC /
# SWIFT_LIBS set. On Linux the Swift runtime libraries must be findable:
# SWIFT_LIBS is prepended to LD_LIBRARY_PATH when running the binary.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${WORK:-$(mktemp -d)}"
SWIFTC="${SWIFTC:-swiftc}"; KOTLINC="${KOTLINC:-kotlinc}"
SWIFT_TARGET_ARGS=${SWIFT_TARGET_ARGS:-}

python3 -I "$here/make_stream.py" "$work/stream.pcm"
python3 -I -c "import struct,sys; d=open(sys.argv[1],'rb').read(); print('\n'.join(str(v) for v in struct.unpack('<%dh' % (len(d)//2), d)))" "$work/stream.pcm" > "$work/stream.txt"

"$SWIFTC" $SWIFT_TARGET_ARGS -O -warnings-as-errors \
  "$here/../ios/HearingVAD.swift" "$here/../ios/HearingPCM.swift" "$here/main.swift" \
  -lm -o "$work/swift-harness"
LD_LIBRARY_PATH="${SWIFT_LIBS:-}:${LD_LIBRARY_PATH:-}" "$work/swift-harness" < "$work/stream.txt" > "$work/swift.out"

python3 -I "$here/make_kotlin_harness.py" "$here/../kotlin/HearingService.kt" "$work/KotlinHarness.kt"
"$KOTLINC" "$work/KotlinHarness.kt" -include-runtime -d "$work/kotlin-harness.jar" 2>"$work/kotlinc.log" \
  || { cat "$work/kotlinc.log"; exit 1; }
java -jar "$work/kotlin-harness.jar" < "$work/stream.txt" > "$work/kotlin.out"

echo "ticks: $(grep -c '^T' "$work/kotlin.out") kotlin / $(grep -c '^T' "$work/swift.out") swift"
echo "kotlin segments:"; grep -E '^(S|E)' "$work/kotlin.out" | sed 's/^/  /'
if diff -u "$work/kotlin.out" "$work/swift.out" > "$work/parity.diff"; then
  echo "PARITY OK — every tick and segment identical, bit for bit"
else
  echo "PARITY BROKEN — see $work/parity.diff"; head -40 "$work/parity.diff"; exit 1
fi
