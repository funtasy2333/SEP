#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
/bin/bash "$ROOT/scripts/ses-local.sh" stop
result=$?
if [ -t 0 ] && [ "${SES_NO_PAUSE:-0}" != 1 ]; then
  read -r -p "按回车关闭此窗口……"
fi
exit "$result"
