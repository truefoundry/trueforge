---
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-ui": patch
---

Keep a turn alive when the provider closes the model stream without a finish reason. The response
it did send is now kept and reported with the new `incomplete` finish reason, and the chat shows a
warning under the answer instead of failing the turn with "Response stream ended without a finish
reason". A stream that ends with no output at all still fails.
