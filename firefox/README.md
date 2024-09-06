# What?

Just a tiny patch for Firefox-based browsers that makes them always give raw `requestBody` (instead of just `formData`) to the [`webRequest.onBeforeRequest` handlers of `WebExtensions` API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest).
