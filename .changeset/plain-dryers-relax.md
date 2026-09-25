---
'@truefoundry/trueforge-ui': patch
---

Fix a stale-closure bug in DropdownMenu: the outside-click and keyboard-navigation handlers now re-subscribe when `setOpen` changes, so a controlled menu with a changing `onOpenChange` callback closes correctly.
