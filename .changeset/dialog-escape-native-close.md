---
'@truefoundry/trueforge-ui': patch
---

On Escape, centered modal / side drawer / bottom sheet overlays let the native `<dialog>` close run again so focus and the top layer clear before React unmounts them.
