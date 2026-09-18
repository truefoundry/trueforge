---
'@truefoundry/trueforge-ui': minor
---

When `withRouter` is off, shell navigation (places + per-route search params) persists in sessionStorage and no longer writes share params to the host URL. Pasted share links still win on boot, then are consumed.
