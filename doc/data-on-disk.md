# Data formats used by `Hoardy-Web`

The file format used by `Hoardy-Web` shall hence be called "Web Request+Response" aka `WRR`, with file extension of `.wrr`.

Internally, a `WRR` file is a [`CBOR` (RFC8949)](https://datatracker.ietf.org/doc/html/rfc8949) encoding of the following structure:

```
reqres = reqresV1

reqresV1 = [
    "WEBREQRES/1",
    agent,
    protocol,
    requestV1,
    responseV1,
    endTimeStamp,
    optionalData,
]

requestV1 = [
    requestTimeStamp,
    requestMethod,
    requestURL,
    requestHeaders,
    isRequestComplete,
    requestBody,
]

responseV1 = null | [
    responseTimeStamp,
    responseStatusCode,
    responseReason,
    responseHeaders,
    isResponseComplete,
    responseBody,
]

optionalData = <map from str to anything>
```

- `agent` is a short description of the agent used to create this `reqres`, like `Firefox/102.0+Hoardy-Web/0.1`;
- `optionalData` currently stores optional `origin_url` and `document_url` when different from both the URL in question and `Referer` request header (this is useful for indexing and search by URL);
- `responseV1` can be `null` when the request got no response, like when experiencing a network issue (archival of such request+response pairs is disabled by default, see extension's settings).

On disk, [dumb archiving server](../simple_server/) stores them one request+response per file, compressed with `gzip` if compression reduces the size and uncompressed otherwise.

Obviously, all of the above has an advantage of making WRR files easily parsable with readily available libraries in basically any programming language there is, CBOR is only slightly less supported than JSON (but it is much more space-efficient and can represent arbitrary binary data).

## Comparison to other web archival formats

And yet, even with it all the being this simple, directories full of non-de-duplicated `.wrr` files are still more efficient than:

- `HAR` archives (unsurprisingly, since `HAR` stores binary data as uncompressed base64-encoded strings inside a JSON, which is at least 200+% blowup in size compared to raw data immediately),

- `mitmproxy` dumps (`Hoardy web` is ~20% better on average for me, but it will depend on how well the sites you visit compress the data they send),

- raw PCAP HTTP traffic dumps (similarly).

After converting all my previous `wget`, `curl`, [mitmproxy](https://github.com/mitmproxy/mitmproxy), and HAR archives into this and with some yet unpublished data de-duplication and xdelta compression between same-URL revisions `Hoardy-Web` is infinitely more efficient, even more efficient than WARC.

For me, it uses about **3GiB per year of browsing** on average (\~5 years of mostly uninterrupted data collection ATM) but I use things like [uBlock Origin](https://github.com/gorhill/uBlock) and [uMatrix](https://github.com/gorhill/uMatrix) to cut things down, and image boorus and video hosting sites have their own pipelines.
